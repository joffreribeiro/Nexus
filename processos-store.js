/**
 * processos-store.js - Único ponto que escreve em estoque.processos (Controle-Estoque)
 *
 * Mesmo adaptador de estado do ponto-store.js/crm-store.js: o estado é o objeto
 * global `estoque` e a persistência é manual via `salvarDados()` (localStorage
 * comprimido + Firestore). `emLote(fn)` executa a mutação e chama `salvarDados()`.
 *
 * Depende de ProcessosModel (global, carregado antes) e de `estoque`/`salvarDados`
 * (definidos em app2.js).
 */
(function () {

    // Delega pro acessor único (shared-state.js) — ver esse arquivo pro porquê.
    function getEstoque() {
        return window.NexusCore.getEstoque();
    }

    function getProcessosState() {
        var e = getEstoque();
        return e ? e.processos : null;
    }

    function persistir(imediato) {
        if (typeof salvarDados === 'function') {
            try { salvarDados(imediato ? { imediato: true } : {}); return; } catch (_) { /* fallback */ }
        }
        if (window.salvarDados) { try { window.salvarDados(imediato ? { imediato: true } : {}); } catch (_) {} }
    }

    function emLote(fn) {
        fn();
        persistir(false);
    }

    /**
     * Garante que estoque.processos existe e está normalizado. Roda na
     * inicialização e após import de backup/migração — mesmo padrão de
     * PontoStore.ensurePontoDefault(). Na primeira carga (itens vazio),
     * dispara a importação inicial do processos_seed.json.
     */
    function ensureProcessosDefault() {
        var e = getEstoque();
        if (!e) return;

        var atual = e.processos;
        var antes = JSON.stringify(atual || null);
        var normalizado = ProcessosModel.normalizarEstadoProcessos(atual);
        var depois = JSON.stringify(normalizado);

        if (depois !== antes) {
            e.processos = normalizado;
            persistir(false);
        } else {
            e.processos = normalizado;
        }

        if (e.processos.itens.length === 0) {
            importarSeedInicial();
        }
    }

    /** Busca processos_seed.json (raiz do repo) e importa — só roda quando estoque.processos.itens está vazio. */
    function importarSeedInicial() {
        if (typeof fetch !== 'function') return;
        fetch('processos_seed.json')
            .then(function (resp) { return resp.ok ? resp.json() : null; })
            .then(function (dados) {
                if (!dados) return;
                // Reconfere no momento em que o fetch resolve: entre o disparo e a
                // resposta, um carregamento do Firestore pode ter trocado `estoque`
                // por um objeto que já tem processos (ex.: sync concluiu antes do
                // fetch local) — não empilha o seed por cima de dados reais.
                var estado = getProcessosState();
                if (estado && estado.itens.length > 0) return;
                importarProcessosSeed(dados);
            })
            .catch(function (err) { console.error('Processos: falha ao importar seed inicial (processos_seed.json)', err); });
    }

    /**
     * Importa processos de um JSON no formato do processos_seed.json (objeto
     * com array `processos`). Não duplica em reimportações — dedupe por `numero`.
     */
    function importarProcessosSeed(seedBruto) {
        var e = getEstoque();
        if (!e) return { importados: 0, ignorados: 0 };
        if (!e.processos) e.processos = ProcessosModel.normalizarEstadoProcessos(null);
        var p = e.processos;

        var existentes = {};
        p.itens.forEach(function (it) { existentes[it.numero] = true; });

        var normalizados = ProcessosModel.normalizarProcessos((seedBruto && seedBruto.processos) || []);
        var novos = normalizados.filter(function (it) { return it.numero && !existentes[it.numero]; });

        if (novos.length) {
            emLote(function () { p.itens = p.itens.concat(novos); });
        }
        return { importados: novos.length, ignorados: normalizados.length - novos.length };
    }

    // ──────────────────────────────────────────────
    //  CRUD
    // ──────────────────────────────────────────────

    function listarProcessos() {
        var p = getProcessosState();
        return p ? p.itens.slice() : [];
    }

    function getProcesso(id) {
        return listarProcessos().filter(function (x) { return x.id === id; })[0] || null;
    }

    function adicionarProcesso(dados) {
        var p = getProcessosState();
        if (!p) return null;
        var erros = ProcessosModel.validarProcesso(dados);
        if (erros.length) return { erros: erros };
        var processo = ProcessosModel.novoProcesso(dados);
        emLote(function () { p.itens.push(processo); });
        return { erros: [], processo: processo };
    }

    function atualizarProcesso(id, patch) {
        var p = getProcessosState();
        if (!p) return null;
        var atual = getProcesso(id);
        if (!atual) return null;
        var mesclado = Object.assign({}, atual, patch, { id: atual.id, atualizadoEm: new Date().toISOString() });
        // numero é imutável na UI — só exige formato estrito quando o patch de fato o altera.
        var numeroAlterado = Object.prototype.hasOwnProperty.call(patch, 'numero') && patch.numero !== atual.numero;
        var erros = ProcessosModel.validarProcesso(mesclado, { ignorarFormatoNumero: !numeroAlterado });
        if (erros.length) return { erros: erros };
        var normalizado = ProcessosModel.normalizarProcesso(mesclado);
        emLote(function () {
            var idx = p.itens.findIndex(function (x) { return x.id === id; });
            if (idx >= 0) p.itens[idx] = normalizado;
        });
        return { erros: [], processo: normalizado };
    }

    function removerProcesso(id) {
        var p = getProcessosState();
        if (!p) return false;
        var idx = p.itens.findIndex(function (x) { return x.id === id; });
        if (idx === -1) return false;
        emLote(function () { p.itens.splice(idx, 1); });
        return true;
    }

    /** Aplica (adiciona) um marcador ao processo — vira `origem: 'marcado'` e limpa a sugestão pendente. */
    function aplicarMarcador(id, marcador) {
        if (!marcador || !marcador.trim()) return null;
        var atual = getProcesso(id);
        if (!atual) return null;
        var m = marcador.trim();
        var marcadores = atual.marcadores.slice();
        if (marcadores.indexOf(m) === -1) marcadores.push(m);
        return atualizarProcesso(id, { marcadores: marcadores, origem: 'marcado', sugestaoMarcador: null });
    }

    /** Remove um marcador do processo — recalcula `origem` (marcado/sem_marcador/nao_triado) a partir do que sobrou. */
    function removerMarcador(id, marcador) {
        var atual = getProcesso(id);
        if (!atual) return null;
        var marcadores = atual.marcadores.filter(function (m) { return m !== marcador; });
        var origem = ProcessosModel.origemParaClassificacao(marcadores, atual.acompanhamentoEspecial);
        return atualizarProcesso(id, { marcadores: marcadores, origem: origem });
    }

    function definirAcompanhamentoEspecial(id, grupos) {
        var lista = (Array.isArray(grupos) ? grupos : [])
            .filter(function (g) { return typeof g === 'string' && g.trim(); })
            .map(function (g) { return g.trim(); });
        return atualizarProcesso(id, { acompanhamentoEspecial: lista });
    }

    /** União dos marcadores padrão do SEI com os já usados nos processos cadastrados — para o seletor de classificação. */
    function listarMarcadoresConhecidos() {
        var set = {};
        (ProcessosModel.MARCADORES_SEI_PADRAO || []).forEach(function (m) { set[m] = true; });
        listarProcessos().forEach(function (p) { p.marcadores.forEach(function (m) { set[m] = true; }); });
        return Object.keys(set).sort();
    }

    window.ProcessosStore = {
        ensureProcessosDefault: ensureProcessosDefault,
        importarProcessosSeed: importarProcessosSeed,

        listarProcessos: listarProcessos,
        getProcesso: getProcesso,
        adicionarProcesso: adicionarProcesso,
        atualizarProcesso: atualizarProcesso,
        removerProcesso: removerProcesso,

        aplicarMarcador: aplicarMarcador,
        removerMarcador: removerMarcador,
        definirAcompanhamentoEspecial: definirAcompanhamentoEspecial,

        listarMarcadoresConhecidos: listarMarcadoresConhecidos,

        emLote: emLote
    };
})();
