/**
 * crm-store.js - Único ponto que escreve em estoque.crm (Controle-Estoque)
 *
 * Adaptador da camada de estado: no Ponto havia um Proxy reativo com auto-save;
 * aqui o estado é o objeto global `estoque` e a persistência é manual via
 * `salvarDados()` (que serializa `estoque` inteiro para localStorage comprimido
 * e agenda o save no Firestore `app_data/latest`). Portanto `emLote(fn)` apenas
 * executa a mutação e chama `salvarDados()`.
 *
 * O CRM NÃO guarda clientes/produtos: lê-os ao vivo de estoque.clientes /
 * estoque.produtos (fonte única). Depende de CrmModel e CrmCalculos (globais,
 * carregados antes) e de `estoque`/`salvarDados` (definidos em app2.js).
 */
(function () {

    var LIMITE_HISTORICO_POR_ENTIDADE = 150;
    var LIMITE_HISTORICO_GLOBAL = 1500;
    var PODAR_A_CADA_N_ESCRITAS = 20;
    var _contadorEscritasHistorico = 0;

    // Delega pro acessor único (shared-state.js) — ver esse arquivo pro porquê.
    function getEstoque() {
        return window.NexusCore.getEstoque();
    }

    function getCrm() {
        var e = getEstoque();
        return e ? e.crm : null;
    }

    function persistir(imediato) {
        if (typeof salvarDados === 'function') {
            try { salvarDados(imediato ? { imediato: true } : {}); return; } catch (_) { /* fallback */ }
        }
        if (window.salvarDados) { try { window.salvarDados(imediato ? { imediato: true } : {}); } catch (_) {} }
    }

    /**
     * Agrupa uma mutação num único save. Sem Proxy: executa e persiste.
     */
    function emLote(fn) {
        fn();
        persistir(false);
    }

    /**
     * Garante que estoque.crm existe e está normalizado. Roda na inicialização
     * e após import de backup. Só grava se algo mudou, para não disparar um
     * write desnecessário no Firestore a cada abertura.
     */
    function ensureCrmDefault() {
        var e = getEstoque();
        if (!e) return;

        var atual = e.crm;
        var antes = JSON.stringify(atual || null);
        var normalizado = CrmModel.normalizarCrm(atual);

        if (!normalizado.funis.length) {
            var seed = CrmModel.funilDeTemplate('vendas');
            normalizado.funis.push(seed);
            normalizado.config.funilAtivoId = seed.id;
        }

        var depois = JSON.stringify(normalizado);
        if (depois !== antes) {
            e.crm = normalizado;
            persistir(false);
        } else {
            e.crm = normalizado; // garante referência normalizada em memória
        }
    }

    // ──────────────────────────────────────────────
    //  LEITURA — CRM
    // ──────────────────────────────────────────────

    function listarFunis() {
        var crm = getCrm();
        return crm ? crm.funis.slice() : [];
    }

    function getFunilAtivo() {
        var crm = getCrm();
        if (!crm) return null;
        return crm.funis.filter(function (f) { return f.id === crm.config.funilAtivoId; })[0] || crm.funis[0] || null;
    }

    function listarNegocios(funilId) {
        var crm = getCrm();
        if (!crm) return [];
        return crm.negocios.filter(function (n) {
            return !n.excluidoEm && (!funilId || n.funilId === funilId);
        });
    }

    function listarNegociosExcluidos(funilId) {
        var crm = getCrm();
        if (!crm) return [];
        return crm.negocios.filter(function (n) {
            return !!n.excluidoEm && (!funilId || n.funilId === funilId);
        });
    }

    function listarAtividades(negocioId) {
        var crm = getCrm();
        if (!crm) return [];
        var todas = crm.atividades || [];
        return negocioId ? todas.filter(function (a) { return a.negocioId === negocioId; }) : todas.slice();
    }

    function historicoDe(entidade, entidadeId) {
        var crm = getCrm();
        if (!crm) return [];
        return CrmCalculos.timelineDe(crm.historico, entidade, entidadeId);
    }

    // ──────────────────────────────────────────────
    //  LEITURA — coleções do ESTOQUE reusadas pelo CRM
    // ──────────────────────────────────────────────

    function listarClientes() {
        var e = getEstoque();
        return (e && Array.isArray(e.clientes)) ? e.clientes.slice() : [];
    }

    function getCliente(id) {
        return listarClientes().filter(function (c) { return String(c.id) === String(id); })[0] || null;
    }

    function listarProdutos() {
        var e = getEstoque();
        return (e && Array.isArray(e.produtos)) ? e.produtos.slice() : [];
    }

    function listarRepresentantes() {
        var e = getEstoque();
        return (e && Array.isArray(e.representantes)) ? e.representantes.slice() : [];
    }

    function listarPropostas() {
        var e = getEstoque();
        return (e && Array.isArray(e.propostas)) ? e.propostas.slice() : [];
    }

    /**
     * Cria um cliente novo no cadastro do Estoque (reuso — o CRM não tem
     * entidade própria de contatos). Mantém o formato usado por salvarCliente.
     */
    function criarCliente(dados) {
        var e = getEstoque();
        if (!e) return null;
        if (!Array.isArray(e.clientes)) e.clientes = [];
        var d = dados || {};
        var novo = {
            id: Date.now().toString(),
            nome: (d.nome || '').trim(),
            cnpj: (d.cnpj || '').trim(),
            tipoPessoa: d.tipoPessoa || 'PJ',
            endereco: (d.endereco || '').trim(),
            cidade: (d.cidade || '').trim(),
            uf: (d.uf || '').trim().toUpperCase(),
            telefone: (d.telefone || '').trim(),
            email: (d.email || '').trim(),
            contato: (d.contato || '').trim(),
            representante: d.representante || '',
            observacoes: (d.observacoes || '').trim()
        };
        emLote(function () {
            e.clientes.push(novo);
            // mantém o espelho global `clientes` em sincronia se ele divergiu
            try { if (typeof clientes !== 'undefined' && clientes !== e.clientes) clientes = e.clientes; } catch (_) {}
        });
        return novo;
    }

    // ──────────────────────────────────────────────
    //  CONFIG DA ABA
    // ──────────────────────────────────────────────

    function setFunilAtivo(id) {
        var crm = getCrm();
        if (!crm) return;
        emLote(function () { crm.config.funilAtivoId = id; });
    }

    function setVisao(visao) {
        var crm = getCrm();
        if (!crm) return;
        var validas = ['kanban', 'lista', 'demandas', 'previsao', 'excluidos', 'timeline', 'painel'];
        emLote(function () { crm.config.visao = validas.indexOf(visao) !== -1 ? visao : 'kanban'; });
    }

    function setSubaba(subaba) {
        var crm = getCrm();
        if (!crm) return;
        emLote(function () { crm.config.subaba = subaba; });
    }

    function setDetalheAberto(id) {
        var crm = getCrm();
        if (!crm) return;
        emLote(function () { crm.config.detalheAbertoId = id || null; });
    }

    function setFiltros(filtros) {
        var crm = getCrm();
        if (!crm) return;
        emLote(function () {
            crm.config.filtros = Object.assign({}, crm.config.filtros, filtros || {});
        });
    }

    // ──────────────────────────────────────────────
    //  HISTÓRICO / NOTAS
    // ──────────────────────────────────────────────

    /**
     * E-mail do usuário logado, para a trilha de auditoria. Lê o `currentUser`
     * que app2.js grava no localStorage no login; acesso defensivo porque o CRM
     * não deve quebrar se rodar isolado (testes, página sem autenticação).
     */
    function autorAtual() {
        try {
            var raw = localStorage.getItem('currentUser');
            if (!raw) return '';
            var u = JSON.parse(raw);
            return (u && u.email) ? u.email : '';
        } catch (e) {
            return '';
        }
    }

    function registrarHistorico(entidade, entidadeId, tipo, texto, dadosExtra) {
        var crm = getCrm();
        if (!crm) return null;
        var item = {
            id: CrmModel.novoId('hst'),
            entidade: entidade,
            entidadeId: entidadeId,
            tipo: tipo,
            texto: texto || '',
            dados: dadosExtra || null,
            autor: autorAtual(),
            editavel: (tipo === 'nota'),
            criadoEm: new Date().toISOString()
        };
        crm.historico.push(item);

        _contadorEscritasHistorico++;
        if (_contadorEscritasHistorico >= PODAR_A_CADA_N_ESCRITAS) {
            _contadorEscritasHistorico = 0;
            podarHistorico();
        }
        return item;
    }

    function adicionarNota(entidade, entidadeId, texto) {
        if (!texto || !String(texto).trim()) return null;
        var crm = getCrm();
        if (!crm) return null;
        var nota = null;
        emLote(function () {
            nota = registrarHistorico(entidade, entidadeId, 'nota', String(texto).trim());
        });
        return nota;
    }

    function editarNota(historicoId, novoTexto) {
        var crm = getCrm();
        if (!crm) return false;
        var item = crm.historico.filter(function (h) { return h.id === historicoId && h.editavel; })[0];
        if (!item) return false;
        emLote(function () {
            item.texto = novoTexto;
            item.editadoEm = new Date().toISOString();
        });
        return true;
    }

    function removerNota(historicoId) {
        var crm = getCrm();
        if (!crm) return false;
        var idx = -1;
        crm.historico.forEach(function (h, i) { if (h.id === historicoId && h.editavel) idx = i; });
        if (idx === -1) return false;
        emLote(function () { crm.historico.splice(idx, 1); });
        return true;
    }

    /**
     * Mantém no máximo LIMITE_HISTORICO_POR_ENTIDADE entradas por entidade e um
     * teto agregado; nunca descarta notas. Faz UMA reatribuição de crm.historico.
     */
    function podarHistorico() {
        var crm = getCrm();
        if (!crm || !crm.historico.length) return false;

        var porEntidade = {};
        var todos = [];
        for (var i = 0; i < crm.historico.length; i++) {
            var h = crm.historico[i];
            todos.push(h);
            var chave = h.entidade + ':' + h.entidadeId;
            (porEntidade[chave] = porEntidade[chave] || []).push(h);
        }

        var idsParaRemover = {};
        Object.keys(porEntidade).forEach(function (chave) {
            var itens = porEntidade[chave]
                .slice()
                .sort(function (a, b) { return String(a.criadoEm).localeCompare(String(b.criadoEm)); });
            var podaveis = itens.filter(function (h) { return !h.editavel; });
            var excedente = podaveis.length - LIMITE_HISTORICO_POR_ENTIDADE;
            if (excedente > 0) {
                podaveis.slice(0, excedente).forEach(function (h) { idsParaRemover[h.id] = true; });
            }
        });

        var sobreviventes = todos.filter(function (h) { return !idsParaRemover[h.id]; });
        if (sobreviventes.length > LIMITE_HISTORICO_GLOBAL) {
            var podaveisGlobal = sobreviventes
                .filter(function (h) { return !h.editavel; })
                .sort(function (a, b) { return String(a.criadoEm).localeCompare(String(b.criadoEm)); });
            var excedenteGlobal = sobreviventes.length - LIMITE_HISTORICO_GLOBAL;
            for (var k = 0; k < excedenteGlobal && k < podaveisGlobal.length; k++) {
                idsParaRemover[podaveisGlobal[k].id] = true;
            }
        }

        if (!Object.keys(idsParaRemover).length) return false;

        var mantidos = todos.filter(function (h) { return !idsParaRemover[h.id]; });
        emLote(function () { crm.historico = mantidos; });
        return true;
    }

    // O Estoque não tem o indicador de tamanho do Ponto — no-op seguro p/ paridade
    function atualizarIndicadorTamanho() { /* sem UI equivalente no Estoque */ }

    // ──────────────────────────────────────────────
    //  NEGÓCIOS
    // ──────────────────────────────────────────────

    function criarNegocio(dados) {
        var crm = getCrm();
        if (!crm) return null;
        var negocio = CrmModel.criarNegocio(dados);
        var irmaos = crm.negocios.filter(function (n) { return n.etapaId === negocio.etapaId && !n.excluidoEm; });
        negocio.ordem = irmaos.length;

        emLote(function () {
            crm.negocios.push(negocio);
            registrarHistorico('negocio', negocio.id, 'criacao', 'Negócio criado');
        });
        return negocio;
    }

    function atualizarNegocio(id, patch) {
        var crm = getCrm();
        if (!crm) return null;
        var n = crm.negocios.filter(function (x) { return x.id === id; })[0];
        if (!n) return null;

        var antes = {};
        CrmModel.CAMPOS_AUDITAVEIS_NEGOCIO.forEach(function (campo) { antes[campo] = n[campo]; });

        emLote(function () {
            Object.keys(patch || {}).forEach(function (campo) {
                if (campo === 'id') return;
                n[campo] = patch[campo];
            });
            n.atualizadoEm = new Date().toISOString();

            CrmModel.CAMPOS_AUDITAVEIS_NEGOCIO.forEach(function (campo) {
                if (Object.prototype.hasOwnProperty.call(patch || {}, campo) && antes[campo] !== n[campo]) {
                    registrarHistorico('negocio', id, 'campo',
                        'Campo "' + campo + '" alterado',
                        { campo: campo, de: antes[campo], para: n[campo] });
                }
            });
        });
        return n;
    }

    function removerNegocio(id) {
        var crm = getCrm();
        if (!crm) return false;
        var n = crm.negocios.filter(function (x) { return x.id === id; })[0];
        if (!n || n.excluidoEm) return false;
        emLote(function () {
            n.excluidoEm = new Date().toISOString();
            registrarHistorico('negocio', id, 'exclusao', 'Negócio movido para Excluídos');
        });
        return true;
    }

    function restaurarNegocio(id) {
        var crm = getCrm();
        if (!crm) return false;
        var n = crm.negocios.filter(function (x) { return x.id === id; })[0];
        if (!n || !n.excluidoEm) return false;
        emLote(function () {
            n.excluidoEm = null;
            registrarHistorico('negocio', id, 'exclusao', 'Negócio restaurado da lixeira');
        });
        return true;
    }

    function excluirNegocioDefinitivo(id) {
        var crm = getCrm();
        if (!crm) return false;
        var idx = -1;
        crm.negocios.forEach(function (n, i) { if (n.id === id) idx = i; });
        if (idx === -1) return false;
        emLote(function () {
            crm.negocios.splice(idx, 1);
            crm.atividades = (crm.atividades || []).filter(function (a) { return a.negocioId !== id; });
            crm.historico = crm.historico.filter(function (h) {
                return !(h.entidade === 'negocio' && h.entidadeId === id);
            });
        });
        return true;
    }

    function setParticipantes(negocioId, pessoaIds) {
        var crm = getCrm();
        if (!crm) return false;
        var n = crm.negocios.filter(function (x) { return x.id === negocioId; })[0];
        if (!n) return false;
        emLote(function () {
            n.participantes = (pessoaIds || []).slice();
            n.atualizadoEm = new Date().toISOString();
        });
        return true;
    }

    function moverNegocio(id, etapaId, indice) {
        var crm = getCrm();
        if (!crm) return false;
        var n = crm.negocios.filter(function (x) { return x.id === id; })[0];
        if (!n) return false;
        var funil = crm.funis.filter(function (f) { return f.id === n.funilId; })[0];
        if (!funil) return false;
        var etapaAnt = funil.etapas.filter(function (e) { return e.id === n.etapaId; })[0] || null;
        var etapaNova = funil.etapas.filter(function (e) { return e.id === etapaId; })[0];
        if (!etapaNova) return false;

        emLote(function () {
            var etapaMudou = !etapaAnt || etapaAnt.id !== etapaNova.id;

            n.etapaId = etapaNova.id;
            n.status = (etapaNova.tipo === 'ganho') ? 'ganho' : (etapaNova.tipo === 'perdido' ? 'perdido' : 'aberto');
            if (n.status !== 'aberto' && !n.dataFechamento) {
                n.dataFechamento = new Date().toISOString().slice(0, 10);
            }
            if (n.status === 'aberto') n.dataFechamento = null;
            n.atualizadoEm = new Date().toISOString();

            var negociosCrus = crm.negocios.map(function (x) {
                return { id: x.id, etapaId: x.etapaId, ordem: x.ordem };
            });
            var novasOrdens = CrmCalculos.reordenarNaEtapa(negociosCrus, etapaNova.id, id, indice);
            novasOrdens.forEach(function (par) {
                var alvo = crm.negocios.filter(function (x) { return x.id === par.id; })[0];
                if (alvo) alvo.ordem = par.ordem;
            });

            if (etapaMudou) {
                registrarHistorico('negocio', id, 'etapa',
                    'Movido de "' + (etapaAnt ? etapaAnt.nome : '—') + '" para "' + etapaNova.nome + '"',
                    { campo: 'etapaId', de: etapaAnt ? etapaAnt.id : null, para: etapaNova.id });
            }
        });
        return true;
    }

    /**
     * Mantém o Quadro coerente com a Lista: quando todas as demandas
     * vinculadas a um negócio ficam "respondida", o card avança sozinho para
     * a etapa de "ganho" do funil; se alguma reabre, ele volta para a etapa
     * "aberta". Negócios sem demanda alguma, ou já perdidos, não são mexidos.
     */
    function sincronizarEtapaComDemandas(negocioId) {
        var crm = getCrm();
        if (!crm || !negocioId) return;
        var n = (crm.negocios || []).filter(function (x) { return x.id === negocioId && !x.excluidoEm; })[0];
        if (!n) return;
        var funil = (crm.funis || []).filter(function (f) { return f.id === n.funilId; })[0];
        if (!funil) return;

        var demandas = (crm.anotacoes || []).filter(function (a) { return a.negocioId === negocioId && !a.excluidoEm; });
        if (!demandas.length) return;

        var etapaGanho = funil.etapas.filter(function (e) { return e.tipo === 'ganho'; })[0];
        var etapaAberta = funil.etapas.filter(function (e) { return e.tipo === 'aberta'; })[0] || funil.etapas[0];
        if (!etapaGanho || !etapaAberta) return;

        var etapaAtual = funil.etapas.filter(function (e) { return e.id === n.etapaId; })[0];
        if (etapaAtual && etapaAtual.tipo === 'perdido') return;

        var todasRespondidas = demandas.every(function (a) { return a.situacao === 'respondida'; });

        if (todasRespondidas && (!etapaAtual || etapaAtual.tipo !== 'ganho')) {
            moverNegocio(negocioId, etapaGanho.id, null);
        } else if (!todasRespondidas && etapaAtual && etapaAtual.tipo === 'ganho') {
            moverNegocio(negocioId, etapaAberta.id, null);
        }
    }

    function marcarGanho(id) {
        var crm = getCrm();
        if (!crm) return false;
        var n = crm.negocios.filter(function (x) { return x.id === id; })[0];
        if (!n) return false;
        var funil = crm.funis.filter(function (f) { return f.id === n.funilId; })[0];
        if (!funil) return false;
        var etapaGanho = funil.etapas.filter(function (e) { return e.tipo === 'ganho'; })[0];
        return etapaGanho ? moverNegocio(id, etapaGanho.id, null) : false;
    }

    function marcarPerdido(id, motivo) {
        var crm = getCrm();
        if (!crm) return false;
        var n = crm.negocios.filter(function (x) { return x.id === id; })[0];
        if (!n) return false;
        var funil = crm.funis.filter(function (f) { return f.id === n.funilId; })[0];
        if (!funil) return false;
        var etapaPerdido = funil.etapas.filter(function (e) { return e.tipo === 'perdido'; })[0];
        if (!etapaPerdido) return false;
        var ok = moverNegocio(id, etapaPerdido.id, null);
        if (ok && motivo) emLote(function () { n.motivoPerda = motivo; });
        return ok;
    }

    // ──────────────────────────────────────────────
    //  ATIVIDADES
    // ──────────────────────────────────────────────

    function criarAtividade(dados) {
        var crm = getCrm();
        if (!crm) return null;
        var atividade = CrmModel.criarAtividade(dados);
        emLote(function () {
            if (!crm.atividades) crm.atividades = [];
            crm.atividades.push(atividade);
            var rotulo = (mapaTiposAtividade()[atividade.tipo] || {}).rotulo || atividade.tipo;
            registrarHistorico('negocio', atividade.negocioId, 'atividade',
                rotulo + ' agendada: ' + atividade.assunto,
                { atividadeId: atividade.id, acao: 'criada' });
        });
        return atividade;
    }

    function atualizarAtividade(id, patch) {
        var crm = getCrm();
        if (!crm) return null;
        var a = (crm.atividades || []).filter(function (x) { return x.id === id; })[0];
        if (!a) return null;
        emLote(function () {
            Object.keys(patch || {}).forEach(function (campo) {
                if (campo === 'id') return;
                a[campo] = patch[campo];
            });
            a.atualizadoEm = new Date().toISOString();
        });
        return a;
    }

    function concluirAtividade(id, feito) {
        var crm = getCrm();
        if (!crm) return false;
        var a = (crm.atividades || []).filter(function (x) { return x.id === id; })[0];
        if (!a) return false;
        var marcar = (feito !== false);
        emLote(function () {
            a.feito = marcar;
            a.feitoEm = marcar ? new Date().toISOString() : null;
            a.atualizadoEm = new Date().toISOString();
            var rotulo = (mapaTiposAtividade()[a.tipo] || {}).rotulo || a.tipo;
            registrarHistorico('negocio', a.negocioId, 'atividade',
                rotulo + (marcar ? ' concluída: ' : ' reaberta: ') + a.assunto,
                { atividadeId: a.id, acao: marcar ? 'concluida' : 'reaberta' });
        });
        return true;
    }

    function removerAtividade(id) {
        var crm = getCrm();
        if (!crm) return false;
        var idx = -1;
        (crm.atividades || []).forEach(function (a, i) { if (a.id === id) idx = i; });
        if (idx === -1) return false;
        emLote(function () { crm.atividades.splice(idx, 1); });
        return true;
    }

    // ──────────────────────────────────────────────
    //  COMENTÁRIOS (mural de discussão por negócio/anotação — não é histórico de auditoria)
    // ──────────────────────────────────────────────

    function listarComentarios(entidade, entidadeId) {
        var crm = getCrm();
        if (!crm) return [];
        return (crm.comentarios || [])
            .filter(function (c) { return c.entidade === entidade && c.entidadeId === entidadeId; })
            .sort(function (a, b) { return String(a.criadoEm || '').localeCompare(String(b.criadoEm || '')); });
    }

    function criarComentario(entidade, entidadeId, texto, autor) {
        var crm = getCrm();
        if (!crm) return null;
        var comentario = CrmModel.criarComentario({ entidade: entidade, entidadeId: entidadeId, texto: texto, autor: autor || '' });
        emLote(function () {
            if (!crm.comentarios) crm.comentarios = [];
            crm.comentarios.push(comentario);
        });
        return comentario;
    }

    function atualizarComentario(id, texto) {
        var crm = getCrm();
        if (!crm) return null;
        var c = (crm.comentarios || []).filter(function (x) { return x.id === id; })[0];
        if (!c) return null;
        emLote(function () {
            c.texto = texto;
            c.mencoes = CrmModel.extrairMencoes(texto);
            c.editadoEm = new Date().toISOString();
        });
        return c;
    }

    function removerComentario(id) {
        var crm = getCrm();
        if (!crm) return false;
        var idx = -1;
        (crm.comentarios || []).forEach(function (c, i) { if (c.id === id) idx = i; });
        if (idx === -1) return false;
        emLote(function () { crm.comentarios.splice(idx, 1); });
        return true;
    }

    // ──────────────────────────────────────────────
    //  ANEXOS (referência a arquivo no Firebase Storage — o binário nunca
    //  entra em estoque.crm; quem faz o upload e obtém a URL é a UI)
    // ──────────────────────────────────────────────

    function listarAnexos(entidade, entidadeId) {
        var crm = getCrm();
        if (!crm) return [];
        return (crm.anexos || [])
            .filter(function (a) { return a.entidade === entidade && a.entidadeId === entidadeId; })
            .sort(function (a, b) { return String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')); });
    }

    function adicionarAnexo(entidade, entidadeId, dadosMetadados) {
        var crm = getCrm();
        if (!crm) return null;
        var anexo = CrmModel.criarAnexo(Object.assign({}, dadosMetadados, {
            entidade: entidade, entidadeId: entidadeId, autor: (dadosMetadados && dadosMetadados.autor) || autorAtual()
        }));
        emLote(function () {
            if (!crm.anexos) crm.anexos = [];
            crm.anexos.push(anexo);
            registrarHistorico(entidade, entidadeId, 'anexo', 'Anexo adicionado: ' + (anexo.nome || '(sem nome)'),
                { anexoId: anexo.id, acao: 'adicionado', nome: anexo.nome });
        });
        return anexo;
    }

    function removerAnexo(id) {
        var crm = getCrm();
        if (!crm) return false;
        var idx = -1;
        (crm.anexos || []).forEach(function (a, i) { if (a.id === id) idx = i; });
        if (idx === -1) return false;
        var removido = crm.anexos[idx];
        emLote(function () {
            crm.anexos.splice(idx, 1);
            registrarHistorico(removido.entidade, removido.entidadeId, 'anexo', 'Anexo removido: ' + (removido.nome || '(sem nome)'),
                { anexoId: removido.id, acao: 'removido', nome: removido.nome });
        });
        return true;
    }

    // ──────────────────────────────────────────────
    //  TIPOS DE ATIVIDADE (personalizáveis pelo usuário)
    // ──────────────────────────────────────────────

    function listarTiposAtividade() {
        var crm = getCrm();
        if (!crm) return [];
        if (!crm.tiposAtividade || !crm.tiposAtividade.length) {
            emLote(function () { crm.tiposAtividade = CrmModel.tiposAtividadePadrao().map(CrmModel.normalizarTipoAtividade); });
        }
        return (crm.tiposAtividade || []).slice().sort(function (a, b) { return a.ordem - b.ordem; });
    }

    function listarTiposAtividadeAtivos() {
        return listarTiposAtividade().filter(function (t) { return t.ativo; });
    }

    /**
     * Mapa chave -> { rotulo, icone }, no formato usado pelo restante do CRM
     * (compatível com o antigo CrmModel.TIPOS_ATIVIDADE). Inclui inativos, para
     * que atividades antigas continuem resolvendo ícone/rótulo corretamente.
     */
    function mapaTiposAtividade() {
        var mapa = {};
        listarTiposAtividade().forEach(function (t) { mapa[t.chave] = { rotulo: t.nome, icone: t.icone }; });
        return mapa;
    }

    function criarTipoAtividade(dados) {
        var crm = getCrm();
        if (!crm) return null;
        var tipos = listarTiposAtividade();
        var novo = CrmModel.normalizarTipoAtividade(Object.assign({}, dados, { ordem: tipos.length }), tipos.length);
        emLote(function () {
            if (!crm.tiposAtividade) crm.tiposAtividade = tipos;
            crm.tiposAtividade.push(novo);
        });
        return novo;
    }

    function atualizarTipoAtividade(chave, patch) {
        var crm = getCrm();
        if (!crm) return null;
        listarTiposAtividade(); // garante que crm.tiposAtividade existe (seed se necessário)
        var t = (crm.tiposAtividade || []).filter(function (x) { return x.chave === chave; })[0];
        if (!t) return null;
        emLote(function () {
            Object.keys(patch || {}).forEach(function (campo) {
                if (campo === 'chave') return;
                t[campo] = patch[campo];
            });
        });
        return t;
    }

    /**
     * Reordena os tipos de atividade a partir de uma lista de chaves na nova
     * ordem desejada. Chaves não incluídas mantêm a posição relativa ao final.
     */
    function reordenarTiposAtividade(chavesNaOrdem) {
        var crm = getCrm();
        if (!crm) return;
        var tipos = listarTiposAtividade();
        var porChave = {};
        tipos.forEach(function (t) { porChave[t.chave] = t; });
        var ordenados = (chavesNaOrdem || []).map(function (c) { return porChave[c]; }).filter(Boolean);
        tipos.forEach(function (t) { if (ordenados.indexOf(t) === -1) ordenados.push(t); });
        emLote(function () {
            ordenados.forEach(function (t, idx) { t.ordem = idx; });
            crm.tiposAtividade = ordenados;
        });
    }

    // ──────────────────────────────────────────────
    //  ANOTAÇÕES / DEMANDAS
    //  O vínculo com negócio é opcional: uma demanda avulsa vive no funil pelos
    //  próprios funilId/etapaId.
    // ──────────────────────────────────────────────

    /**
     * O histórico da demanda é ancorado no negócio pai quando ele existe (para
     * continuar aparecendo na timeline do negócio) e na própria demanda quando
     * ela é avulsa.
     */
    function ancoraHistorico(anotacao) {
        return anotacao.negocioId
            ? { entidade: 'negocio', id: anotacao.negocioId }
            : { entidade: 'anotacao', id: anotacao.id };
    }

    function registrarNaDemanda(anotacao, texto, dadosExtra) {
        var ancora = ancoraHistorico(anotacao);
        return registrarHistorico(ancora.entidade, ancora.id, 'anotacao', texto,
            Object.assign({ anotacaoId: anotacao.id }, dadosExtra || {}));
    }

    /**
     * `filtro` aceita uma string (negocioId, forma legada) ou
     * { negocioId, funilId, incluirExcluidas }.
     */
    function listarAnotacoes(filtro) {
        var crm = getCrm();
        if (!crm) return [];
        var f = (typeof filtro === 'string') ? { negocioId: filtro } : (filtro || {});
        return (crm.anotacoes || []).filter(function (a) {
            if (!f.incluirExcluidas && a.excluidoEm) return false;
            if (f.negocioId && a.negocioId !== f.negocioId) return false;
            if (f.funilId && !a.negocioId && a.funilId !== f.funilId) return false;
            return true;
        });
    }

    function getAnotacao(id) {
        var crm = getCrm();
        if (!crm) return null;
        return (crm.anotacoes || []).filter(function (a) { return a.id === id; })[0] || null;
    }

    function criarAnotacao(dados) {
        var crm = getCrm();
        if (!crm) return null;
        var anotacao = CrmModel.criarAnotacao(dados);
        // Mesma derivação de atualizarAnotacao: uma demanda já nascida
        // "respondida" precisa da data de conclusão, agora que o campo não é
        // mais digitável no modal.
        aplicarSituacao(anotacao, anotacao.situacao);
        emLote(function () {
            if (!crm.anotacoes) crm.anotacoes = [];
            crm.anotacoes.push(anotacao);
            registrarNaDemanda(anotacao, 'Demanda criada: ' + anotacao.assunto, { acao: 'criada' });
            if (anotacao.negocioId) sincronizarEtapaComDemandas(anotacao.negocioId);
        });
        return anotacao;
    }

    function atualizarAnotacao(id, patch) {
        var crm = getCrm();
        if (!crm) return null;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === id; })[0];
        if (!a) return null;

        var antes = {};
        CrmModel.CAMPOS_AUDITAVEIS_ANOTACAO.forEach(function (campo) { antes[campo] = a[campo]; });

        emLote(function () {
            Object.keys(patch || {}).forEach(function (campo) {
                if (campo === 'id') return;
                a[campo] = patch[campo];
            });
            // `finalizado` é consequência da situação, nunca fonte da verdade.
            var negociosParaSincronizar = {};
            if (Object.prototype.hasOwnProperty.call(patch || {}, 'situacao')) {
                aplicarSituacao(a, a.situacao);
                if (a.situacao === 'respondida') marcarThreadComoRespondida(crm, a.id, negociosParaSincronizar);
            }
            a.atualizadoEm = new Date().toISOString();

            CrmModel.CAMPOS_AUDITAVEIS_ANOTACAO.forEach(function (campo) {
                if (Object.prototype.hasOwnProperty.call(patch || {}, campo) && antes[campo] !== a[campo]) {
                    registrarNaDemanda(a, 'Campo "' + campo + '" alterado',
                        { campo: campo, de: antes[campo], para: a[campo] });
                }
            });

            if (a.negocioId) negociosParaSincronizar[a.negocioId] = true;
            Object.keys(negociosParaSincronizar).forEach(function (nid) { sincronizarEtapaComDemandas(nid); });
        });
        return a;
    }

    /** Sobe a cadeia de vínculos até a demanda que não é filha de nenhuma outra. */
    function raizDaThread(crm, id) {
        var porId = {};
        (crm.anotacoes || []).forEach(function (x) { porId[x.id] = x; });
        var atual = porId[id];
        var vistos = {};
        while (atual && atual.anotacaoRelacionadaId && porId[atual.anotacaoRelacionadaId] && !vistos[atual.id]) {
            vistos[atual.id] = true;
            atual = porId[atual.anotacaoRelacionadaId];
        }
        return atual || null;
    }

    /**
     * Ao responder/concluir qualquer demanda de uma thread vinculada, a thread
     * inteira acompanha — sobe até a raiz do vínculo e desce por todas as
     * ligadas a ela, evitando ficar com uma respondida e as outras esquecidas
     * em aberto (não importa qual delas foi respondida primeiro).
     */
    function marcarThreadComoRespondida(crm, id, negociosParaSincronizar) {
        negociosParaSincronizar = negociosParaSincronizar || {};
        var raiz = raizDaThread(crm, id);
        if (!raiz) return negociosParaSincronizar;
        if (raiz.negocioId) negociosParaSincronizar[raiz.negocioId] = true;
        if (raiz.situacao !== 'respondida') {
            var de = raiz.situacao;
            aplicarSituacao(raiz, 'respondida');
            raiz.atualizadoEm = new Date().toISOString();
            registrarNaDemanda(raiz, 'Situação: ' + de + ' → respondida (herdada de demanda vinculada)',
                { campo: 'situacao', de: de, para: 'respondida' });
        }
        cascatearSituacaoParaFilhas(crm, raiz.id, 'respondida', negociosParaSincronizar);
        return negociosParaSincronizar;
    }

    function cascatearSituacaoParaFilhas(crm, paiId, situacao, negociosParaSincronizar) {
        negociosParaSincronizar = negociosParaSincronizar || {};
        var filhas = (crm.anotacoes || []).filter(function (x) { return x.anotacaoRelacionadaId === paiId && !x.excluidoEm; });
        filhas.forEach(function (filha) {
            if (filha.negocioId) negociosParaSincronizar[filha.negocioId] = true;
            if (filha.situacao === situacao) return;
            var de = filha.situacao;
            aplicarSituacao(filha, situacao);
            filha.atualizadoEm = new Date().toISOString();
            registrarNaDemanda(filha, 'Situação: ' + de + ' → ' + situacao + ' (herdada de demanda vinculada)',
                { campo: 'situacao', de: de, para: situacao });
            cascatearSituacaoParaFilhas(crm, filha.id, situacao, negociosParaSincronizar);
        });
        return negociosParaSincronizar;
    }

    /** Sincroniza os derivados de situação. Não grava histórico nem salva. */
    function aplicarSituacao(a, situacao) {
        a.situacao = situacao;
        a.finalizado = (situacao === 'respondida');
        if (a.finalizado) {
            if (!a.dataConclusao) a.dataConclusao = new Date().toISOString().slice(0, 10);
        } else {
            a.dataConclusao = null;
        }
    }

    function setSituacaoAnotacao(id, situacao) {
        var crm = getCrm();
        if (!crm) return false;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === id; })[0];
        if (!a) return false;
        if (CrmModel.SITUACOES_ANOTACAO.indexOf(situacao) === -1) return false;
        if (a.situacao === situacao) return true;
        var de = a.situacao;
        emLote(function () {
            aplicarSituacao(a, situacao);
            a.atualizadoEm = new Date().toISOString();
            registrarNaDemanda(a, 'Situação: ' + de + ' → ' + situacao,
                { campo: 'situacao', de: de, para: situacao });
            var negociosParaSincronizar = {};
            if (situacao === 'respondida') marcarThreadComoRespondida(crm, a.id, negociosParaSincronizar);
            if (a.negocioId) negociosParaSincronizar[a.negocioId] = true;
            Object.keys(negociosParaSincronizar).forEach(function (nid) { sincronizarEtapaComDemandas(nid); });
        });
        return true;
    }

    /** Wrapper legado sobre setSituacaoAnotacao. */
    function concluirAnotacao(id, finalizado) {
        return setSituacaoAnotacao(id, (finalizado !== false) ? 'respondida' : 'comigo');
    }

    /** Soft delete, alinhado ao tratamento dado aos negócios. */
    function removerAnotacao(id) {
        var crm = getCrm();
        if (!crm) return false;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === id; })[0];
        if (!a || a.excluidoEm) return false;
        emLote(function () {
            a.excluidoEm = new Date().toISOString();
            a.atualizadoEm = a.excluidoEm;
            registrarNaDemanda(a, 'Demanda excluída: ' + a.assunto, { acao: 'excluida' });
            if (a.negocioId) sincronizarEtapaComDemandas(a.negocioId);
        });
        return true;
    }

    function restaurarAnotacao(id) {
        var crm = getCrm();
        if (!crm) return false;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === id; })[0];
        if (!a || !a.excluidoEm) return false;
        emLote(function () {
            a.excluidoEm = null;
            a.atualizadoEm = new Date().toISOString();
            registrarNaDemanda(a, 'Demanda restaurada: ' + a.assunto, { acao: 'restaurada' });
            if (a.negocioId) sincronizarEtapaComDemandas(a.negocioId);
        });
        return true;
    }

    // ── Encaminhamentos (pedidos de informação a terceiros) ──

    function getEncaminhamento(anotacao, encId) {
        return (anotacao.encaminhamentos || []).filter(function (e) { return e.id === encId; })[0] || null;
    }

    /**
     * Reavalia a situação a partir dos encaminhamentos. Só aplica quando muda,
     * e nunca reabre uma demanda já respondida (ver CrmCalculos.situacaoSugerida).
     */
    function sincronizarSituacao(a) {
        var sugerida = CrmCalculos.situacaoSugerida(a);
        if (sugerida === a.situacao) return;
        var de = a.situacao;
        aplicarSituacao(a, sugerida);
        registrarNaDemanda(a, 'Situação: ' + de + ' → ' + sugerida,
            { campo: 'situacao', de: de, para: sugerida, automatico: true });
    }

    function adicionarEncaminhamento(anotacaoId, dados) {
        var crm = getCrm();
        if (!crm) return null;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === anotacaoId; })[0];
        if (!a) return null;
        var enc = CrmModel.criarEncaminhamento(dados);
        emLote(function () {
            if (!Array.isArray(a.encaminhamentos)) a.encaminhamentos = [];
            a.encaminhamentos.push(enc);
            a.atualizadoEm = new Date().toISOString();
            registrarNaDemanda(a, 'Encaminhado a ' + (enc.para || '(sem destinatário)'),
                { encaminhamentoId: enc.id, acao: 'encaminhado', para: enc.para });
            sincronizarSituacao(a);
        });
        return enc;
    }

    function atualizarEncaminhamento(anotacaoId, encId, patch) {
        var crm = getCrm();
        if (!crm) return null;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === anotacaoId; })[0];
        if (!a) return null;
        var enc = getEncaminhamento(a, encId);
        if (!enc) return null;
        var statusAntes = enc.status;
        emLote(function () {
            Object.keys(patch || {}).forEach(function (campo) {
                if (campo === 'id') return;
                enc[campo] = patch[campo];
            });
            enc.atualizadoEm = new Date().toISOString();
            a.atualizadoEm = enc.atualizadoEm;
            if (enc.status !== statusAntes) {
                registrarNaDemanda(a, 'Encaminhamento a ' + (enc.para || '?') + ': ' + statusAntes + ' → ' + enc.status,
                    { encaminhamentoId: enc.id, de: statusAntes, para: enc.status });
            }
            sincronizarSituacao(a);
        });
        return enc;
    }

    function responderEncaminhamento(anotacaoId, encId, dados) {
        var d = dados || {};
        return atualizarEncaminhamento(anotacaoId, encId, {
            status: 'respondido',
            dataResposta: d.dataResposta || new Date().toISOString().slice(0, 10),
            resposta: typeof d.resposta === 'string' ? d.resposta : ''
        });
    }

    function removerEncaminhamento(anotacaoId, encId) {
        var crm = getCrm();
        if (!crm) return false;
        var a = (crm.anotacoes || []).filter(function (x) { return x.id === anotacaoId; })[0];
        if (!a) return false;
        var idx = -1;
        (a.encaminhamentos || []).forEach(function (e, i) { if (e.id === encId) idx = i; });
        if (idx === -1) return false;
        var removido = a.encaminhamentos[idx];
        emLote(function () {
            a.encaminhamentos.splice(idx, 1);
            a.atualizadoEm = new Date().toISOString();
            registrarNaDemanda(a, 'Encaminhamento a ' + (removido.para || '?') + ' removido',
                { encaminhamentoId: encId, acao: 'removido' });
            sincronizarSituacao(a);
        });
        return true;
    }

    // ──────────────────────────────────────────────
    //  FUNIS
    // ──────────────────────────────────────────────

    function criarFunil(dados) {
        var crm = getCrm();
        if (!crm) return null;
        var funil = (dados && dados.template) ? CrmModel.funilDeTemplate(dados.template) : CrmModel.criarFunil(dados);
        if (!funil) return null;
        if (dados && dados.nome) funil.nome = dados.nome;
        emLote(function () {
            crm.funis.push(funil);
            if (!crm.config.funilAtivoId) crm.config.funilAtivoId = funil.id;
        });
        return funil;
    }

    function atualizarFunil(id, patch) {
        var crm = getCrm();
        if (!crm) return null;
        var f = crm.funis.filter(function (x) { return x.id === id; })[0];
        if (!f) return null;
        emLote(function () {
            Object.keys(patch || {}).forEach(function (campo) {
                if (campo === 'id' || campo === 'etapas') return;
                f[campo] = patch[campo];
            });
            f.atualizadoEm = new Date().toISOString();
        });
        return f;
    }

    function definirEtapasFunil(funilId, etapasBrutas) {
        var crm = getCrm();
        if (!crm) return null;
        var f = crm.funis.filter(function (x) { return x.id === funilId; })[0];
        if (!f) return null;
        var etapas = (etapasBrutas || [])
            .map(function (e, idx) { return CrmModel.normalizarEtapa(e, idx); })
            .sort(function (a, b) { return a.ordem - b.ordem; });
        emLote(function () {
            f.etapas = etapas;
            f.atualizadoEm = new Date().toISOString();
        });
        return f;
    }

    function arquivarFunil(id, arquivado) {
        var crm = getCrm();
        if (!crm) return false;
        var f = crm.funis.filter(function (x) { return x.id === id; })[0];
        if (!f) return false;
        emLote(function () { f.arquivado = (arquivado !== false); });
        return true;
    }

    // Força persistência imediata (usado no fim do drag-and-drop)
    function flush() { persistir(true); }

    window.CrmStore = {
        ensureCrmDefault: ensureCrmDefault,
        getCrm: getCrm,
        atualizarIndicadorTamanho: atualizarIndicadorTamanho,
        flush: flush,

        listarFunis: listarFunis,
        getFunilAtivo: getFunilAtivo,
        listarNegocios: listarNegocios,
        listarNegociosExcluidos: listarNegociosExcluidos,
        listarAtividades: listarAtividades,
        historicoDe: historicoDe,

        listarAnotacoes: listarAnotacoes,
        getAnotacao: getAnotacao,
        criarAnotacao: criarAnotacao,
        atualizarAnotacao: atualizarAnotacao,
        concluirAnotacao: concluirAnotacao,
        setSituacaoAnotacao: setSituacaoAnotacao,
        removerAnotacao: removerAnotacao,
        restaurarAnotacao: restaurarAnotacao,
        adicionarEncaminhamento: adicionarEncaminhamento,
        atualizarEncaminhamento: atualizarEncaminhamento,
        responderEncaminhamento: responderEncaminhamento,
        removerEncaminhamento: removerEncaminhamento,

        listarComentarios: listarComentarios,
        criarComentario: criarComentario,
        atualizarComentario: atualizarComentario,
        removerComentario: removerComentario,

        listarAnexos: listarAnexos,
        adicionarAnexo: adicionarAnexo,
        removerAnexo: removerAnexo,

        listarClientes: listarClientes,
        getCliente: getCliente,
        criarCliente: criarCliente,
        listarProdutos: listarProdutos,
        listarRepresentantes: listarRepresentantes,
        listarPropostas: listarPropostas,

        setFunilAtivo: setFunilAtivo,
        setVisao: setVisao,
        setSubaba: setSubaba,
        setDetalheAberto: setDetalheAberto,
        setFiltros: setFiltros,

        registrarHistorico: registrarHistorico,
        adicionarNota: adicionarNota,
        editarNota: editarNota,
        removerNota: removerNota,
        podarHistorico: podarHistorico,

        criarNegocio: criarNegocio,
        atualizarNegocio: atualizarNegocio,
        removerNegocio: removerNegocio,
        restaurarNegocio: restaurarNegocio,
        excluirNegocioDefinitivo: excluirNegocioDefinitivo,
        setParticipantes: setParticipantes,
        moverNegocio: moverNegocio,
        marcarGanho: marcarGanho,
        marcarPerdido: marcarPerdido,

        criarAtividade: criarAtividade,
        atualizarAtividade: atualizarAtividade,
        concluirAtividade: concluirAtividade,
        removerAtividade: removerAtividade,

        listarTiposAtividade: listarTiposAtividade,
        listarTiposAtividadeAtivos: listarTiposAtividadeAtivos,
        mapaTiposAtividade: mapaTiposAtividade,
        criarTipoAtividade: criarTipoAtividade,
        atualizarTipoAtividade: atualizarTipoAtividade,
        reordenarTiposAtividade: reordenarTiposAtividade,

        criarFunil: criarFunil,
        atualizarFunil: atualizarFunil,
        definirEtapasFunil: definirEtapasFunil,
        arquivarFunil: arquivarFunil,

        emLote: emLote
    };
})();
