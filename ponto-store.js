/**
 * ponto-store.js - Único ponto que escreve em estoque.ponto (Controle-Estoque)
 *
 * Mesmo adaptador de estado do crm-store.js: o estado é o objeto global
 * `estoque` e a persistência é manual via `salvarDados()` (localStorage
 * comprimido + Firestore). `emLote(fn)` executa a mutação e chama
 * `salvarDados()`.
 *
 * Depende de PontoModel (global, carregado antes) e de `estoque`/`salvarDados`
 * (definidos em app2.js).
 */
(function () {

    // Delega pro acessor único (shared-state.js) — ver esse arquivo pro porquê.
    function getEstoque() {
        return window.NexusCore.getEstoque();
    }

    function getPonto() {
        var e = getEstoque();
        return e ? e.ponto : null;
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
     * Garante que estoque.ponto existe e está normalizado. Roda na
     * inicialização e após import de backup/migração — mesmo padrão de
     * CrmStore.ensureCrmDefault(). Só grava se algo mudou.
     */
    function ensurePontoDefault() {
        var e = getEstoque();
        if (!e) return;

        var atual = e.ponto;
        var antes = JSON.stringify(atual || null);
        var normalizado = PontoModel.normalizarPonto(atual);
        var depois = JSON.stringify(normalizado);

        if (depois !== antes) {
            e.ponto = normalizado;
            persistir(false);
        } else {
            e.ponto = normalizado;
        }
    }

    // ──────────────────────────────────────────────
    //  ADMISSÃO / CONFIGURAÇÕES
    // ──────────────────────────────────────────────

    function getAdmissao() {
        var p = getPonto();
        return p ? p.admissao : null;
    }

    function setAdmissao(dataIso) {
        var p = getPonto();
        if (!p) return;
        emLote(function () { p.admissao = PontoModel.normalizarDataIso(dataIso); });
    }

    function getConfiguracoes() {
        var p = getPonto();
        return p ? p.configuracoes : null;
    }

    function atualizarConfiguracoes(patch) {
        var p = getPonto();
        if (!p) return null;
        var erros = PontoModel.validarConfiguracoes(Object.assign({}, p.configuracoes, patch));
        if (erros.length) return { erros: erros };
        emLote(function () {
            p.configuracoes = PontoModel.normalizarConfiguracoes(Object.assign({}, p.configuracoes, patch));
        });
        return { erros: [] };
    }

    // ──────────────────────────────────────────────
    //  REGISTROS (um por dia, chave = data)
    // ──────────────────────────────────────────────

    function listarRegistros() {
        var p = getPonto();
        return p ? p.registros.slice() : [];
    }

    function getRegistro(data) {
        return listarRegistros().filter(function (r) { return r.data === data; })[0] || null;
    }

    /** Cria ou substitui o registro do dia (mesma regra do Ponto: um registro por data). */
    function salvarRegistro(dados) {
        var p = getPonto();
        if (!p) return null;
        var erros = PontoModel.validarRegistro(dados);
        if (erros.length) return { erros: erros };
        var registro = PontoModel.criarRegistro(dados);
        emLote(function () {
            var idx = p.registros.findIndex(function (r) { return r.data === registro.data; });
            if (idx >= 0) p.registros[idx] = registro;
            else { p.registros.push(registro); p.registros.sort(function (a, b) { return a.data < b.data ? -1 : (a.data > b.data ? 1 : 0); }); }
        });
        return { erros: [], registro: registro };
    }

    function removerRegistro(data) {
        var p = getPonto();
        if (!p) return false;
        var idx = p.registros.findIndex(function (r) { return r.data === data; });
        if (idx === -1) return false;
        emLote(function () { p.registros.splice(idx, 1); });
        return true;
    }

    // ──────────────────────────────────────────────
    //  EVENTOS
    // ──────────────────────────────────────────────

    function listarEventos() {
        var p = getPonto();
        return p ? p.eventos.slice() : [];
    }

    function getEvento(id) {
        return listarEventos().filter(function (e) { return e.id === id; })[0] || null;
    }

    function criarEvento(dados) {
        var p = getPonto();
        if (!p) return null;
        var erros = PontoModel.validarEvento(dados);
        if (erros.length) return { erros: erros };
        var evento = PontoModel.criarEvento(dados);
        emLote(function () { p.eventos.push(evento); });
        return { erros: [], evento: evento };
    }

    function atualizarEvento(id, patch) {
        var p = getPonto();
        if (!p) return null;
        var atual = getEvento(id);
        if (!atual) return null;
        var mesclado = Object.assign({}, atual, patch, { id: atual.id });
        var erros = PontoModel.validarEvento(mesclado);
        if (erros.length) return { erros: erros };
        var normalizado = PontoModel.normalizarEvento(mesclado);
        emLote(function () {
            var idx = p.eventos.findIndex(function (e) { return e.id === id; });
            if (idx >= 0) p.eventos[idx] = normalizado;
        });
        return { erros: [], evento: normalizado };
    }

    /** Remove um evento por índice no array bruto — mesmo padrão seguro do Ponto (splice + confirmação prévia na UI). */
    function removerEvento(id) {
        var p = getPonto();
        if (!p) return false;
        var idx = p.eventos.findIndex(function (e) { return e.id === id; });
        if (idx === -1) return false;
        emLote(function () { p.eventos.splice(idx, 1); });
        return true;
    }

    // ──────────────────────────────────────────────
    //  ACORDOS
    // ──────────────────────────────────────────────

    function listarAcordos() {
        var p = getPonto();
        return p ? p.acordos.slice() : [];
    }

    function getAcordo(id) {
        return listarAcordos().filter(function (a) { return a.id === id; })[0] || null;
    }

    function criarAcordo(dados) {
        var p = getPonto();
        if (!p) return null;
        var erros = PontoModel.validarAcordo(dados);
        if (erros.length) return { erros: erros };
        var acordo = PontoModel.criarAcordo(dados);
        emLote(function () { p.acordos.push(acordo); });
        return { erros: [], acordo: acordo };
    }

    function atualizarAcordo(id, patch) {
        var p = getPonto();
        if (!p) return null;
        var atual = getAcordo(id);
        if (!atual) return null;
        var mesclado = Object.assign({}, atual, patch, { id: atual.id });
        var erros = PontoModel.validarAcordo(mesclado);
        if (erros.length) return { erros: erros };
        var normalizado = PontoModel.normalizarAcordo(mesclado);
        emLote(function () {
            var idx = p.acordos.findIndex(function (a) { return a.id === id; });
            if (idx >= 0) p.acordos[idx] = normalizado;
        });
        return { erros: [], acordo: normalizado };
    }

    function removerAcordo(id) {
        var p = getPonto();
        if (!p) return false;
        var idx = p.acordos.findIndex(function (a) { return a.id === id; });
        if (idx === -1) return false;
        emLote(function () { p.acordos.splice(idx, 1); });
        return true;
    }

    // ──────────────────────────────────────────────
    //  PERÍODOS AQUISITIVOS (Férias)
    // ──────────────────────────────────────────────

    function listarPeriodosAquisitivos() {
        var p = getPonto();
        return p ? p.periodosAquisitivos.slice() : [];
    }

    function criarPeriodoAquisitivo(dados) {
        var p = getPonto();
        if (!p) return null;
        var periodo = PontoModel.criarPeriodoAquisitivo(dados);
        emLote(function () { p.periodosAquisitivos.push(periodo); });
        return periodo;
    }

    function atualizarPeriodoAquisitivo(id, patch) {
        var p = getPonto();
        if (!p) return null;
        var atual = p.periodosAquisitivos.filter(function (x) { return x.id === id; })[0];
        if (!atual) return null;
        var normalizado = PontoModel.normalizarPeriodoAquisitivo(Object.assign({}, atual, patch, { id: atual.id }));
        emLote(function () {
            var idx = p.periodosAquisitivos.findIndex(function (x) { return x.id === id; });
            if (idx >= 0) p.periodosAquisitivos[idx] = normalizado;
        });
        return normalizado;
    }

    function removerPeriodoAquisitivo(id) {
        var p = getPonto();
        if (!p) return false;
        var idx = p.periodosAquisitivos.findIndex(function (x) { return x.id === id; });
        if (idx === -1) return false;
        emLote(function () { p.periodosAquisitivos.splice(idx, 1); });
        return true;
    }

    // ──────────────────────────────────────────────
    //  TIPOS DE EVENTO (catálogo)
    // ──────────────────────────────────────────────

    function listarTiposEvento() {
        var p = getPonto();
        return p ? p.tiposEvento.slice() : [];
    }

    // ──────────────────────────────────────────────
    //  CÁLCULO (delega a PontoCalculos, sem duplicar a regra aqui)
    // ──────────────────────────────────────────────

    function totalizarPeriodo() {
        var p = getPonto();
        if (!p) return null;
        return PontoCalculos.calculatePeriodTotals(p.registros, p.eventos, p.acordos);
    }

    function calcularDia(data) {
        var p = getPonto();
        if (!p) return null;
        var registro = getRegistro(data);
        return PontoCalculos.calculateDayWithContext(p.registros, p.eventos, p.acordos, data, registro);
    }

    // ──────────────────────────────────────────────
    //  MIGRAÇÃO (Fase 2) — grava um dados.ponto já migrado/normalizado
    // ──────────────────────────────────────────────

    /**
     * Recebe o objeto `dados` bruto vindo do Firestore do Ponto (sem o
     * sub-objeto `crm`, descartado antes de chamar isto), normaliza e grava em
     * estoque.ponto. Usado uma única vez pelo fluxo de migração admin.
     */
    function importarDadosMigrados(dadosBrutos) {
        var e = getEstoque();
        if (!e) return null;
        var normalizado = PontoModel.normalizarPonto(dadosBrutos);
        emLote(function () { e.ponto = normalizado; });
        return normalizado;
    }

    window.PontoStore = {
        ensurePontoDefault: ensurePontoDefault,

        getAdmissao: getAdmissao,
        setAdmissao: setAdmissao,
        getConfiguracoes: getConfiguracoes,
        atualizarConfiguracoes: atualizarConfiguracoes,

        listarRegistros: listarRegistros,
        getRegistro: getRegistro,
        salvarRegistro: salvarRegistro,
        removerRegistro: removerRegistro,

        listarEventos: listarEventos,
        getEvento: getEvento,
        criarEvento: criarEvento,
        atualizarEvento: atualizarEvento,
        removerEvento: removerEvento,

        listarAcordos: listarAcordos,
        getAcordo: getAcordo,
        criarAcordo: criarAcordo,
        atualizarAcordo: atualizarAcordo,
        removerAcordo: removerAcordo,

        listarPeriodosAquisitivos: listarPeriodosAquisitivos,
        criarPeriodoAquisitivo: criarPeriodoAquisitivo,
        atualizarPeriodoAquisitivo: atualizarPeriodoAquisitivo,
        removerPeriodoAquisitivo: removerPeriodoAquisitivo,

        listarTiposEvento: listarTiposEvento,

        totalizarPeriodo: totalizarPeriodo,
        calcularDia: calcularDia,

        importarDadosMigrados: importarDadosMigrados,

        emLote: emLote
    };
})();
