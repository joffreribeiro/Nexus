/**
 * cloud-store.js - Persistência em nuvem por módulo (Controle-Estoque)
 *
 * FASE 1 de uma migração em duas etapas (ver conversa/PR): hoje o sistema
 * inteiro — estoque, CRM, Ponto, propostas, tudo — é salvo como um único
 * documento Firestore (`app_data/latest`, escrito por `salvarNoCloud()` em
 * app2.js). Isso tem dois problemas reais:
 *   1. Teto de 1 MiB por documento do Firestore — CRM e Ponto acumulam
 *      histórico para sempre; um dia o documento estoura esse limite.
 *   2. "Quem salva por último apaga o outro": dois usuários editando módulos
 *      diferentes ao mesmo tempo colidem, porque o save de um sobrescreve o
 *      documento INTEIRO, inclusive a parte que o outro acabou de mudar.
 *
 * Este arquivo implementa a base da correção: em vez de um documento,
 * `app_data/estoque`, `app_data/crm` e `app_data/ponto` — três documentos
 * independentes. Editar o CRM não toca mais no documento do Estoque ou do
 * Ponto, e cada um tem seu próprio orçamento de 1 MiB.
 *
 * Por que só três documentos, e não um por entidade (um por negócio do CRM,
 * um por produto, etc.)? Essa granularidade maior eliminaria de vez o teto de
 * tamanho, mas exigiria reescrever toda mutação do app (hoje toda alteração
 * de CRM/Ponto/Estoque passa por um único `salvarDados()` que serializa o
 * objeto inteiro — ver crm-store.js/ponto-store.js) para gravar só a entidade
 * que mudou. É uma mudança de arquitetura bem maior, fora do escopo desta
 * primeira fase.
 *
 * ESTADO ATUAL — cutover concluído, escrita dupla removida:
 *   - `salvarNoCloud()` (app2.js) grava via `salvarModulosNoCloud()`, só nos
 *     três documentos por módulo. A escrita no legado `app_data/latest` foi
 *     removida porque o conjunto passou de 1 MiB e o Firestore recusava a
 *     gravação inteira ("size exceeds the maximum allowed size"), derrubando
 *     todo o save. Agora cada módulo tem o seu próprio orçamento de 1 MiB.
 *   - As leituras (`carregarDoCloud`, `carregarDoCloudAuto`) passam por
 *     `lerEstadoCompativel()`, que escolhe a fonte mais recente e devolve
 *     sempre o formato antigo, mantendo o resto dessas funções intacto. O
 *     legado continua sendo LIDO como fallback, então a base antiga ainda
 *     serve de origem enquanto os documentos por módulo não forem gravados.
 *   - `app_data/latest` não é apagado, mas a partir daqui fica congelado: o
 *     rollback para o código anterior perde as alterações feitas depois deste
 *     ponto (e, de todo modo, o código antigo já não conseguia gravar).
 *   - `verificarTamanhoDosModulos()` roda antes de cada save e falha com uma
 *     mensagem dizendo QUAL módulo estourou o 1 MiB — o erro cru do Firestore
 *     só informa o total do documento.
 *
 * Funções puras (dividirEstoqueEmModulos/remontarEstoqueAPartirDeModulos) não
 * tocam Firestore e são testadas isoladamente com Vitest. As demais exigem
 * uma instância do Firestore (`db`, passada explicitamente — nunca lida de
 * `window` aqui, para que o mesmo código funcione contra o emulador nos
 * testes e, futuramente, contra produção).
 */
(function () {

    var NOMES_MODULO = { ESTOQUE: 'estoque', CRM: 'crm', PONTO: 'ponto' };
    var COLECAO = 'app_data';
    var DOC_LEGADO = 'latest';
    // Teto de 1 MiB por documento imposto pelo Firestore, e o ponto a partir
    // do qual já vale avisar (80%).
    var LIMITE_DOC_BYTES = 1048576;
    var AVISO_BYTES = Math.floor(LIMITE_DOC_BYTES * 0.8);

    /**
     * Devolve uma cópia sem a chave `updatedAt` — cada documento de módulo
     * carrega o seu próprio carimbo de tempo, que é metadado de persistência
     * e não deve vazar para dentro de `estoque.crm`/`estoque.ponto` (onde
     * seria re-salvo e acumularia a cada ciclo).
     */
    function semUpdatedAt(dados) {
        if (!dados || typeof dados !== 'object') return dados;
        var copia = {};
        Object.keys(dados).forEach(function (k) { if (k !== 'updatedAt') copia[k] = dados[k]; });
        return copia;
    }

    /** Converte um Timestamp do Firestore (ou Date) para Date; null se não der. */
    function paraDate(valor) {
        if (!valor) return null;
        if (typeof valor.toDate === 'function') {
            try { return valor.toDate(); } catch (e) { return null; }
        }
        if (valor instanceof Date) return valor;
        return null;
    }

    /**
     * Separa o objeto `estoque` (hoje um único blob com tudo) em três partes
     * independentes. `crm` e `ponto` já são sub-objetos isolados dentro de
     * `estoque` (ver crm-store.js/ponto-store.js — "Único ponto que escreve
     * em estoque.crm/estoque.ponto"); esta função só formaliza essa fronteira
     * que já existe na prática.
     * @param {object} estoque
     * @returns {{estoqueCore: object, crm: object|null, ponto: object|null}}
     */
    function dividirEstoqueEmModulos(estoque) {
        if (!estoque || typeof estoque !== 'object') {
            return { estoqueCore: {}, crm: null, ponto: null };
        }
        var estoqueCore = {};
        Object.keys(estoque).forEach(function (chave) {
            if (chave === 'crm' || chave === 'ponto') return;
            estoqueCore[chave] = estoque[chave];
        });
        return {
            estoqueCore: estoqueCore,
            crm: (estoque.crm !== undefined) ? estoque.crm : null,
            ponto: (estoque.ponto !== undefined) ? estoque.ponto : null
        };
    }

    /**
     * Inverso de dividirEstoqueEmModulos: reconstrói o objeto `estoque`
     * completo a partir dos três módulos carregados separadamente. `crm`/
     * `ponto` nulos (documento daquele módulo não existia ainda) simplesmente
     * não são anexados — mesmo formato que o código hoje já trata quando
     * `estoque.crm`/`estoque.ponto` estão ausentes (ensureCrmDefault/
     * ensurePontoDefault criam o default na primeira execução).
     * @param {{estoqueCore: object, crm: object|null, ponto: object|null}} modulos
     * @returns {object}
     */
    function remontarEstoqueAPartirDeModulos(modulos) {
        var estoqueCore = (modulos && modulos.estoqueCore) || {};
        var estoque = {};
        Object.keys(estoqueCore).forEach(function (chave) { estoque[chave] = estoqueCore[chave]; });
        if (modulos && modulos.crm !== undefined && modulos.crm !== null) estoque.crm = modulos.crm;
        if (modulos && modulos.ponto !== undefined && modulos.ponto !== null) estoque.ponto = modulos.ponto;
        return estoque;
    }

    /**
     * Grava os três documentos em paralelo. `firebase` é o namespace global
     * do SDK compat (mesmo usado em app2.js) — precisa dele só para
     * `FieldValue.serverTimestamp()`; não lê nada de `window.estoque`.
     * @param {object} db - instância do Firestore (ex.: window.firestoreDB)
     * @param {object} firebaseNS - namespace `firebase` (para FieldValue)
     * @param {object} estoque - objeto estoque completo (com .crm/.ponto)
     * @returns {Promise<{estoqueCore: object, crm: object, ponto: object}>} os dados efetivamente gravados, já com updatedAt
     */
    /**
     * Tamanho aproximado, em bytes, que um payload ocupará no Firestore.
     * Não é a fórmula exata do Firestore (que soma nome do documento, nomes
     * de campo e overhead de índices), mas o JSON serializado em UTF-8 é uma
     * aproximação boa o bastante para avisar antes de bater no teto.
     */
    function tamanhoAproximadoBytes(valor) {
        try {
            var json = JSON.stringify(valor, function (k, v) {
                // serverTimestamp() é um sentinela do SDK, não serializa —
                // vira ~8 bytes no documento final.
                return (k === 'updatedAt') ? null : v;
            });
            if (!json) return 0;
            if (typeof Blob !== 'undefined') return new Blob([json]).size;
            if (typeof Buffer !== 'undefined') return Buffer.byteLength(json, 'utf8');
            return json.length;
        } catch (e) { return 0; }
    }

    /**
     * Tamanho aproximado de cada um dos três documentos de módulo. Útil para
     * diagnosticar de onde vem o peso quando o save falha por tamanho.
     * @returns {{estoque: number, crm: number, ponto: number}}
     */
    function tamanhosDosModulos(estoque) {
        var modulos = dividirEstoqueEmModulos(estoque);
        return {
            estoque: tamanhoAproximadoBytes(modulos.estoqueCore),
            crm: tamanhoAproximadoBytes(modulos.crm || {}),
            ponto: tamanhoAproximadoBytes(modulos.ponto || {})
        };
    }

    /**
     * Barra o save antes de ir ao Firestore quando algum módulo passou do
     * teto de 1 MiB, com uma mensagem que diz QUAL módulo estourou e quanto
     * ele ocupa — o erro cru do Firestore só informa o total do documento.
     * Acima de AVISO_BYTES apenas registra um aviso no console.
     * @throws {Error} se algum módulo exceder LIMITE_DOC_BYTES
     */
    function verificarTamanhoDosModulos(estoque) {
        var tamanhos = tamanhosDosModulos(estoque);
        var excedidos = Object.keys(tamanhos).filter(function (m) { return tamanhos[m] > LIMITE_DOC_BYTES; });
        if (excedidos.length) {
            var detalhe = excedidos.map(function (m) {
                return 'app_data/' + m + ' (' + Math.round(tamanhos[m] / 1024) + ' KiB)';
            }).join(', ');
            throw new Error(
                'Documento acima do limite de 1 MiB do Firestore: ' + detalhe +
                '. Reduza o histórico desse módulo antes de salvar na nuvem.'
            );
        }
        Object.keys(tamanhos).forEach(function (m) {
            if (tamanhos[m] > AVISO_BYTES) {
                console.warn('CloudStore: app_data/' + m + ' está em ' + Math.round(tamanhos[m] / 1024) +
                    ' KiB, perto do teto de 1024 KiB por documento do Firestore.');
            }
        });
        return tamanhos;
    }

    async function salvarModulosNoCloud(db, firebaseNS, estoque) {
        if (!db) throw new Error('salvarModulosNoCloud: db é obrigatório');
        verificarTamanhoDosModulos(estoque);
        var modulos = dividirEstoqueEmModulos(estoque);
        var timestamp = (firebaseNS && firebaseNS.firestore && firebaseNS.firestore.FieldValue)
            ? firebaseNS.firestore.FieldValue.serverTimestamp()
            : new Date();

        var payloadEstoque = Object.assign({}, modulos.estoqueCore, { updatedAt: timestamp });
        var payloadCrm = Object.assign({}, modulos.crm || {}, { updatedAt: timestamp });
        var payloadPonto = Object.assign({}, modulos.ponto || {}, { updatedAt: timestamp });

        await Promise.all([
            db.collection(COLECAO).doc(NOMES_MODULO.ESTOQUE).set(payloadEstoque),
            db.collection(COLECAO).doc(NOMES_MODULO.CRM).set(payloadCrm),
            db.collection(COLECAO).doc(NOMES_MODULO.PONTO).set(payloadPonto)
        ]);

        return { estoqueCore: payloadEstoque, crm: payloadCrm, ponto: payloadPonto };
    }

    /**
     * Lê os três documentos em paralelo e remonta o objeto `estoque`
     * completo. Documento inexistente (ex.: `crm` antes da primeira gravação)
     * vira `null` no módulo correspondente — remontarEstoqueAPartirDeModulos
     * já sabe lidar com isso.
     * @param {object} db
     * @returns {Promise<object>} objeto estoque remontado
     */
    /**
     * Leitura interna dos três documentos: devolve o estoque remontado (já
     * sem os `updatedAt` de cada módulo) mais o carimbo de tempo mais recente
     * entre eles — necessário para decidir, em lerEstadoCompativel, se os
     * documentos novos ou o legado estão mais atualizados.
     * @returns {Promise<{estoque: object, updatedAtRaw: *, updatedAtDate: Date|null, existeAlgum: boolean}>}
     */
    async function _lerModulos(db) {
        var refs = [
            db.collection(COLECAO).doc(NOMES_MODULO.ESTOQUE),
            db.collection(COLECAO).doc(NOMES_MODULO.CRM),
            db.collection(COLECAO).doc(NOMES_MODULO.PONTO)
        ];
        var snaps = await Promise.all(refs.map(function (ref) { return ref.get(); }));
        var dados = snaps.map(function (s) { return s.exists ? (s.data() || {}) : null; });

        // Guarda o Timestamp bruto (não um Date) do módulo mais recente: os
        // consumidores em app2.js chamam `.toDate()` nele, como já faziam com
        // o documento legado.
        var updatedAtRaw = null;
        var updatedAtDate = null;
        dados.forEach(function (d) {
            if (!d) return;
            var data = paraDate(d.updatedAt);
            if (data && (!updatedAtDate || data.getTime() > updatedAtDate.getTime())) {
                updatedAtDate = data;
                updatedAtRaw = d.updatedAt;
            }
        });

        var estoque = remontarEstoqueAPartirDeModulos({
            estoqueCore: dados[0] ? semUpdatedAt(dados[0]) : {},
            crm: dados[1] ? semUpdatedAt(dados[1]) : null,
            ponto: dados[2] ? semUpdatedAt(dados[2]) : null
        });

        return {
            estoque: estoque,
            updatedAtRaw: updatedAtRaw,
            updatedAtDate: updatedAtDate,
            existeAlgum: dados.some(function (d) { return d !== null; })
        };
    }

    /**
     * Lê os três documentos e remonta o objeto `estoque` completo. Documento
     * inexistente (ex.: `crm` antes da primeira gravação) simplesmente não
     * vira chave no resultado.
     * @param {object} db
     * @returns {Promise<object>} objeto estoque remontado
     */
    async function carregarModulosDoCloud(db) {
        if (!db) throw new Error('carregarModulosDoCloud: db é obrigatório');
        var res = await _lerModulos(db);
        return res.estoque;
    }

    /**
     * Migração única: lê o documento legado `app_data/latest` e copia seu
     * conteúdo para os três documentos novos. NÃO apaga nem altera o
     * documento legado — ele continua sendo o ponto de rollback caso algo dê
     * errado na migração ou na fase seguinte (trocar os pontos de leitura do
     * app). Seguro rodar mais de uma vez (idempotente: sempre reflete o
     * estado atual do documento legado no momento da chamada).
     * @param {object} db
     * @param {object} firebaseNS
     * @returns {Promise<{migrado: boolean, motivo?: string}>}
     */
    async function migrarDocumentoUnico(db, firebaseNS) {
        if (!db) throw new Error('migrarDocumentoUnico: db é obrigatório');
        var docLegadoRef = db.collection(COLECAO).doc(DOC_LEGADO);
        var snap = await docLegadoRef.get();
        if (!snap.exists) {
            return { migrado: false, motivo: 'Documento legado app_data/latest não existe.' };
        }
        var dados = snap.data() || {};
        // O documento legado guarda o estoque sob a chave `estado` (ver
        // salvarNoCloud em app2.js: `docRef.set({ estado: estoque, ... })`).
        var estoqueCompleto = dados.estado || {};
        await salvarModulosNoCloud(db, firebaseNS, estoqueCompleto);
        return { migrado: true };
    }

    /**
     * Lê o estado da nuvem devolvendo SEMPRE o mesmo formato que o documento
     * legado tinha (`{ estado, precificacoesCliente, updatedAt, ... }`), venha
     * ele dos documentos novos ou do legado — é o que permite trocar a fonte
     * em app2.js sem reescrever as funções que consomem esses campos.
     *
     * Escolhe a fonte pelo `updatedAt` mais recente. Durante a escrita dupla
     * as duas fontes são equivalentes (mesmo carimbo), então a escolha é
     * indiferente; a comparação existe para cobrir os períodos de transição:
     * dados migrados mas ainda não regravados, ou uma sessão com código antigo
     * que gravou só no legado.
     *
     * @param {object} db
     * @returns {Promise<{data: object|null, origem: 'modulos'|'legado'|null}>}
     */
    async function lerEstadoCompativel(db) {
        if (!db) throw new Error('lerEstadoCompativel: db é obrigatório');
        var resultados = await Promise.all([
            _lerModulos(db),
            db.collection(COLECAO).doc(DOC_LEGADO).get()
        ]);
        var mods = resultados[0];
        var legadoSnap = resultados[1];
        var legadoData = legadoSnap.exists ? legadoSnap.data() : null;
        var legadoDate = legadoData ? paraDate(legadoData.updatedAt) : null;

        function respostaDosModulos() {
            return {
                origem: 'modulos',
                data: {
                    estado: mods.estoque,
                    precificacoesCliente: mods.estoque.precificacoesCliente || [],
                    updatedAt: mods.updatedAtRaw
                }
            };
        }

        var modulosMaisNovos = mods.existeAlgum && mods.updatedAtDate &&
            (!legadoDate || mods.updatedAtDate.getTime() > legadoDate.getTime());
        if (modulosMaisNovos) return respostaDosModulos();
        if (legadoData) return { origem: 'legado', data: legadoData };
        if (mods.existeAlgum) return respostaDosModulos();
        return { origem: null, data: null };
    }

    /**
     * Carimbo de tempo (em ms) mais recente entre todos os documentos de um
     * QuerySnapshot da coleção `app_data`. Usado pelo listener em tempo real,
     * que passou a observar a coleção inteira em vez de um único documento —
     * assim ele detecta alteração em qualquer módulo.
     * @returns {number|null}
     */
    function timestampMaisRecenteDeSnapshot(querySnapshot) {
        if (!querySnapshot || typeof querySnapshot.forEach !== 'function') return null;
        var maior = null;
        querySnapshot.forEach(function (doc) {
            var d = paraDate((doc.data() || {}).updatedAt);
            if (d && (!maior || d.getTime() > maior.getTime())) maior = d;
        });
        return maior ? maior.getTime() : null;
    }

    var CloudStore = {
        dividirEstoqueEmModulos: dividirEstoqueEmModulos,
        remontarEstoqueAPartirDeModulos: remontarEstoqueAPartirDeModulos,
        salvarModulosNoCloud: salvarModulosNoCloud,
        carregarModulosDoCloud: carregarModulosDoCloud,
        migrarDocumentoUnico: migrarDocumentoUnico,
        tamanhoAproximadoBytes: tamanhoAproximadoBytes,
        tamanhosDosModulos: tamanhosDosModulos,
        verificarTamanhoDosModulos: verificarTamanhoDosModulos,
        LIMITE_DOC_BYTES: LIMITE_DOC_BYTES,
        lerEstadoCompativel: lerEstadoCompativel,
        timestampMaisRecenteDeSnapshot: timestampMaisRecenteDeSnapshot,
        NOMES_MODULO: NOMES_MODULO
    };

    if (typeof window !== 'undefined') window.CloudStore = CloudStore;
    if (typeof module !== 'undefined' && module.exports) module.exports = CloudStore;

})();
