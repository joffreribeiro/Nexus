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
 * FASE 1b — mais dois módulos separados (`processos`, `registroVendas):
 *   Depois da Fase 1, `app_data/estoque` sozinho ainda concentrava ~40% do
 *   que sobrou (~420 KiB numa base real): `processos` (72 KiB) já era um
 *   sub-objeto isolado — mesmo padrão de `crm`/`ponto`, só nunca tinha sido
 *   separado — e `registroVendas` (90 KiB, maior fatia) é um log que só
 *   cresce, mesma natureza de `auditoriaVendas` (que já tinha sido separada
 *   por esse motivo). `propostas`/`precificacoesCliente` foram cogitados
 *   primeiro mas medidos e descartados — pequenos (~16 KiB somados numa base
 *   real), não são o risco. Mesmo padrão da Fase 1, sem mudança de
 *   arquitetura nova: só estende dividirEstoqueEmModulos/
 *   remontarEstoqueAPartirDeModulos com dois módulos a mais.
 *
 * ESTADO ATUAL — cutover concluído, escrita dupla removida:
 *   - `salvarNoCloud()` (app2.js) grava via `salvarModulosNoCloud()`, só nos
 *     documentos por módulo (estoque/crm/ponto/auditoria/processos/vendas). A
 *     escrita no legado `app_data/latest` foi removida porque o conjunto
 *     passou de 1 MiB e o Firestore recusava a gravação inteira ("size
 *     exceeds the maximum allowed size"), derrubando todo o save. Agora cada
 *     módulo tem o seu próprio orçamento de 1 MiB.
 *   - As leituras (`carregarDoCloud`, `carregarDoCloudAuto`) passam por
 *     `lerEstadoCompativel()`, que escolhe a fonte mais recente e devolve
 *     sempre o formato antigo, mantendo o resto dessas funções intacto. A
 *     fonte são sempre os módulos quando existe pelo menos um deles; o legado
 *     só é lido numa base que nunca passou pela migração. Ele NÃO disputa
 *     mais por carimbo de tempo: congelado como está, vencer essa disputa
 *     significava o app reverter para um estado antigo (ver
 *     lerEstadoCompativel).
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

    var NOMES_MODULO = {
        ESTOQUE: 'estoque', CRM: 'crm', PONTO: 'ponto', AUDITORIA: 'auditoria',
        PROCESSOS: 'processos', VENDAS: 'vendas'
    };
    // Ordem usada em todas as operações que percorrem os módulos — a posição
    // de cada nome aqui tem que bater com a posição correspondente em
    // _lerModulos (dados[0]..dados[5]) e no Promise.all de salvarModulosNoCloud.
    var TODOS_MODULOS = [
        NOMES_MODULO.ESTOQUE, NOMES_MODULO.CRM, NOMES_MODULO.PONTO, NOMES_MODULO.AUDITORIA,
        NOMES_MODULO.PROCESSOS, NOMES_MODULO.VENDAS
    ];
    // Chave do estoque que vira o documento de auditoria. Diferente de crm e
    // ponto, que já são sub-objetos, esta é um array — e array não pode ser a
    // raiz de um documento Firestore, daí o envelope { registros: [...] }.
    var CHAVE_AUDITORIA = 'auditoriaVendas';
    // Idem para o documento de vendas — registroVendas também é um array.
    var CHAVE_VENDAS = 'registroVendas';
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
     * Separa o objeto `estoque` em partes independentes. `crm`, `ponto` e
     * `processos` já são sub-objetos isolados dentro de `estoque` (ver
     * crm-store.js/ponto-store.js/processos-store.js — "Único ponto que
     * escreve em estoque.crm/estoque.ponto/estoque.processos"); para eles
     * esta função só formaliza uma fronteira que já existe.
     *
     * `auditoriaVendas` e `registroVendas` saíram depois, por peso: juntas
     * concentravam boa parte do documento `app_data/estoque` (medido numa
     * base real: 21%+ só de registroVendas). São logs append-only, então
     * tirá-los do caminho do resto do estoque não custa nada. Como são
     * arrays e array não pode ser a raiz de um documento Firestore, vão
     * dentro de `{ registros: [...] }`.
     * @param {object} estoque
     * @returns {{estoqueCore: object, crm: object|null, ponto: object|null, auditoria: {registros: Array}|null, processos: object|null, vendas: {registros: Array}|null}}
     */
    function dividirEstoqueEmModulos(estoque) {
        if (!estoque || typeof estoque !== 'object') {
            return { estoqueCore: {}, crm: null, ponto: null, auditoria: null, processos: null, vendas: null };
        }
        var estoqueCore = {};
        Object.keys(estoque).forEach(function (chave) {
            if (chave === 'crm' || chave === 'ponto' || chave === 'processos' ||
                chave === CHAVE_AUDITORIA || chave === CHAVE_VENDAS) return;
            estoqueCore[chave] = estoque[chave];
        });
        return {
            estoqueCore: estoqueCore,
            crm: (estoque.crm !== undefined) ? estoque.crm : null,
            ponto: (estoque.ponto !== undefined) ? estoque.ponto : null,
            processos: (estoque.processos !== undefined) ? estoque.processos : null,
            auditoria: (estoque[CHAVE_AUDITORIA] !== undefined)
                ? { registros: estoque[CHAVE_AUDITORIA] }
                : null,
            vendas: (estoque[CHAVE_VENDAS] !== undefined)
                ? { registros: estoque[CHAVE_VENDAS] }
                : null
        };
    }

    /**
     * Inverso de dividirEstoqueEmModulos: reconstrói o objeto `estoque`
     * completo a partir dos três módulos carregados separadamente. `crm`/
     * `ponto` nulos (documento daquele módulo não existia ainda) simplesmente
     * não são anexados — mesmo formato que o código hoje já trata quando
     * `estoque.crm`/`estoque.ponto` estão ausentes (ensureCrmDefault/
     * ensurePontoDefault criam o default na primeira execução).
     * @param {{estoqueCore: object, crm: object|null, ponto: object|null, processos: object|null, auditoria: {registros: Array}|null, vendas: {registros: Array}|null}} modulos
     * @returns {object}
     */
    function remontarEstoqueAPartirDeModulos(modulos) {
        var estoqueCore = (modulos && modulos.estoqueCore) || {};
        var estoque = {};
        Object.keys(estoqueCore).forEach(function (chave) { estoque[chave] = estoqueCore[chave]; });
        if (modulos && modulos.crm !== undefined && modulos.crm !== null) estoque.crm = modulos.crm;
        if (modulos && modulos.ponto !== undefined && modulos.ponto !== null) estoque.ponto = modulos.ponto;
        if (modulos && modulos.processos !== undefined && modulos.processos !== null) estoque.processos = modulos.processos;
        // Auditoria/Vendas: quando a chave ainda aparece dentro do
        // estoqueCore, ela vence — só uma versão anterior à separação grava
        // assim, e ela grava depois, então é o valor mais novo (o documento
        // próprio do módulo ficou para trás naquele save). No fluxo normal a
        // chave não existe no estoqueCore e o documento próprio é a fonte.
        if (modulos && modulos.auditoria && Array.isArray(modulos.auditoria.registros)
            && !Array.isArray(estoque[CHAVE_AUDITORIA])) {
            estoque[CHAVE_AUDITORIA] = modulos.auditoria.registros;
        }
        if (modulos && modulos.vendas && Array.isArray(modulos.vendas.registros)
            && !Array.isArray(estoque[CHAVE_VENDAS])) {
            estoque[CHAVE_VENDAS] = modulos.vendas.registros;
        }
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
     * Tamanho aproximado de cada documento de módulo. Útil para diagnosticar
     * de onde vem o peso quando o save falha por tamanho.
     * @returns {{estoque: number, crm: number, ponto: number, auditoria: number, processos: number, vendas: number}}
     */
    function tamanhosDosModulos(estoque) {
        var modulos = dividirEstoqueEmModulos(estoque);
        return {
            estoque: tamanhoAproximadoBytes(modulos.estoqueCore),
            crm: tamanhoAproximadoBytes(modulos.crm || {}),
            ponto: tamanhoAproximadoBytes(modulos.ponto || {}),
            auditoria: tamanhoAproximadoBytes(modulos.auditoria || {}),
            processos: tamanhoAproximadoBytes(modulos.processos || {}),
            vendas: tamanhoAproximadoBytes(modulos.vendas || {})
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
        var payloadProcessos = Object.assign({}, modulos.processos || {}, { updatedAt: timestamp });
        // Sem `registros: []` como default: um estoque que nunca teve
        // auditoria/vendas não deve ganhar a chave de volta na leitura (mesma
        // simetria de crm/ponto/processos, e o que mantém o round-trip fiel
        // ao original).
        var payloadAuditoria = Object.assign({}, modulos.auditoria || {}, { updatedAt: timestamp });
        var payloadVendas = Object.assign({}, modulos.vendas || {}, { updatedAt: timestamp });

        await Promise.all([
            db.collection(COLECAO).doc(NOMES_MODULO.ESTOQUE).set(payloadEstoque),
            db.collection(COLECAO).doc(NOMES_MODULO.CRM).set(payloadCrm),
            db.collection(COLECAO).doc(NOMES_MODULO.PONTO).set(payloadPonto),
            db.collection(COLECAO).doc(NOMES_MODULO.AUDITORIA).set(payloadAuditoria),
            db.collection(COLECAO).doc(NOMES_MODULO.PROCESSOS).set(payloadProcessos),
            db.collection(COLECAO).doc(NOMES_MODULO.VENDAS).set(payloadVendas)
        ]);

        return {
            estoqueCore: payloadEstoque, crm: payloadCrm, ponto: payloadPonto,
            auditoria: payloadAuditoria, processos: payloadProcessos, vendas: payloadVendas
        };
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
        var refs = TODOS_MODULOS.map(function (nome) { return db.collection(COLECAO).doc(nome); });
        var snaps = await Promise.all(refs.map(function (ref) { return ref.get(); }));
        var dados = snaps.map(function (s) { return s.exists ? (s.data() || {}) : null; });
        // Índice pelo nome, não pela posição — mais seguro que dados[0]/[1]/[2]
        // conforme TODOS_MODULOS cresce (era exatamente esse tipo de
        // dessincronia que causava bug ao adicionar um módulo).
        var porNome = {};
        TODOS_MODULOS.forEach(function (nome, i) { porNome[nome] = dados[i]; });

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
            estoqueCore: porNome[NOMES_MODULO.ESTOQUE] ? semUpdatedAt(porNome[NOMES_MODULO.ESTOQUE]) : {},
            crm: porNome[NOMES_MODULO.CRM] ? semUpdatedAt(porNome[NOMES_MODULO.CRM]) : null,
            ponto: porNome[NOMES_MODULO.PONTO] ? semUpdatedAt(porNome[NOMES_MODULO.PONTO]) : null,
            processos: porNome[NOMES_MODULO.PROCESSOS] ? semUpdatedAt(porNome[NOMES_MODULO.PROCESSOS]) : null,
            auditoria: porNome[NOMES_MODULO.AUDITORIA] ? semUpdatedAt(porNome[NOMES_MODULO.AUDITORIA]) : null,
            vendas: porNome[NOMES_MODULO.VENDAS] ? semUpdatedAt(porNome[NOMES_MODULO.VENDAS]) : null
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
     * A fonte são SEMPRE os documentos por módulo, quando existe pelo menos
     * um deles. O legado só é lido quando nenhum módulo existe ainda — ou
     * seja, numa base que nunca passou pela migração.
     *
     * Antes esta função escolhia pelo `updatedAt` mais recente, e isso virou
     * um bug de perda de dados quando a escrita no legado parou (documento
     * acima de 1 MiB): `app_data/latest` congelou com um estado antigo, mas
     * continuava elegível a vencer a comparação. Bastava os módulos virem sem
     * carimbo legível — `updatedAt` ainda pendente logo após um save, leitura
     * servida do cache offline, documento gravado por um caminho que não
     * setou o campo — para `mods.updatedAtDate` ser null, o legado ser
     * escolhido, e o app substituir o estado atual por aquela versão velha.
     * Como o `carregarDoCloud` seguinte persiste o que leu, a reversão se
     * propagava para o local e para a nuvem.
     *
     * Comparar carimbos só fazia sentido enquanto as duas fontes eram
     * escritas juntas. Com o legado congelado, ele nunca pode ser a versão
     * mais nova — então não entra mais na disputa.
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

        if (mods.existeAlgum) {
            return {
                origem: 'modulos',
                data: {
                    estado: mods.estoque,
                    precificacoesCliente: mods.estoque.precificacoesCliente || [],
                    updatedAt: mods.updatedAtRaw
                }
            };
        }
        if (legadoData) return { origem: 'legado', data: legadoData };
        return { origem: null, data: null };
    }

    /**
     * Fotografia dos quatro documentos de `app_data` — qual existe, quando
     * foi atualizado e quanto ocupa. Serve para responder "qual máquina está
     * com o estado certo e de onde ela leu", sem abrir o console do Firebase.
     * Só lê; não escreve nada.
     * @param {object} db
     * @returns {Promise<Array<{doc: string, existe: boolean, updatedAt: Date|null, bytes: number}>>}
     */
    async function diagnosticoDosDocumentos(db) {
        if (!db) throw new Error('diagnosticoDosDocumentos: db é obrigatório');
        var nomes = TODOS_MODULOS.concat([DOC_LEGADO]);
        var snaps = await Promise.all(nomes.map(function (n) {
            return db.collection(COLECAO).doc(n).get();
        }));
        return snaps.map(function (snap, i) {
            var dados = snap.exists ? (snap.data() || {}) : null;
            return {
                doc: COLECAO + '/' + nomes[i],
                existe: !!dados,
                updatedAt: dados ? paraDate(dados.updatedAt) : null,
                bytes: dados ? tamanhoAproximadoBytes(dados) : 0
            };
        });
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
        diagnosticoDosDocumentos: diagnosticoDosDocumentos,
        NOMES_MODULO: NOMES_MODULO
    };

    if (typeof window !== 'undefined') window.CloudStore = CloudStore;
    if (typeof module !== 'undefined' && module.exports) module.exports = CloudStore;

})();
