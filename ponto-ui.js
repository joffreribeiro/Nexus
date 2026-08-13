/**
 * ponto-ui.js - Orquestração da aba de Ponto (jornada/RH)
 * Fase 1 do plano de migração: só a navegação interna (sub-abas) e
 * placeholders. Conteúdo real de cada sub-aba (Folha, Registros, Acordos,
 * Eventos, Férias) entra na Fase 3, reaproveitando PontoStore/PontoCalculos.
 *
 * Segue o mesmo padrão delegado do crm-ui.js (ver crm-ui.js:3051-3066), mas
 * com seu próprio atributo (`data-ponto-action`) e mapa de ações — o módulo é
 * dono do próprio clique, sem depender do listener do CRM.
 */
(function () {
    var esc = function (v) { return (window.Utils && Utils.escapeHtml) ? Utils.escapeHtml(v) : String(v == null ? '' : v); };

    var SUBABAS = [
        { chave: 'folha', rotulo: 'Folha de Ponto' },
        { chave: 'registros', rotulo: 'Registros' },
        { chave: 'acordos', rotulo: 'Acordos' },
        { chave: 'eventos', rotulo: 'Eventos' },
        { chave: 'ferias', rotulo: 'Férias' }
    ];

    var _subaba = 'folha';
    var _mesRegistros = null;     // 'YYYY-MM' | null
    var _acordoTimesheet = null;  // índice do acordo exibido na Folha de Ponto | null
    var _folhaDeveRolar = true;   // true logo após abrir a Folha de Ponto (ou trocar de acordo) — rola até o mês atual uma vez e desliga

    // Filtros das listas (mesmos campos das telas do Ponto original)
    var _fReg = { acordo: '', de: '', ate: '', justificativa: '', saldo: '', obs: '' };

    // Lista de registros já filtrada/ordenada por renderizarRegistros(), consumida por
    // montarRegistrosLazy() logo após o HTML ser inserido no DOM — ver comentário lá.
    var _registrosParaRenderizarLazy = [];
    var _fEvt = { acordo: '', tipo: '', de: '', ate: '' };
    var _buscaAcordos = '';
    var _acordoSecoesAbertas = {}; // 'acordoId:secao' -> boolean (estado de expandir/recolher dos cards)

    var LABEL_ATESTADO = {
        afastamento: '🏥 Afastamento',
        comparecimento_matutino: '🌅 Comp. Manhã',
        comparecimento_vespertino: '🌇 Comp. Tarde',
        abono_matutino: '🟢 Abono Manhã',
        abono_vespertino: '🟢 Abono Tarde',
        abono_dia_todo: '🟢 Abono Dia'
    };
    var BADGE_ATESTADO = {
        afastamento: 'reg-badge-atestado',
        comparecimento_matutino: 'reg-badge-atestado',
        comparecimento_vespertino: 'reg-badge-atestado',
        abono_matutino: 'reg-badge-abono',
        abono_vespertino: 'reg-badge-abono',
        abono_dia_todo: 'reg-badge-abono'
    };
    var LABEL_PERIODO = { dia_todo: 'Dia todo', matutino: 'Manhã', vespertino: 'Tarde' };
    var DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    /** Índice do acordo vigente numa data (usado pelos filtros por acordo). */
    function indiceAcordoDaData(acordos, data) {
        var ac = PontoCalculos.getAcordoByData(acordos, data);
        return ac ? acordos.indexOf(ac) : -1;
    }

    function diaSemanaDe(iso) {
        var p = (iso || '').split('-');
        if (p.length !== 3) return '';
        return DIAS_SEMANA[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()] || '';
    }

    function opcoesAcordo(selecionado, rotuloVazio) {
        return '<option value="">' + esc(rotuloVazio) + '</option>' +
            PontoStore.listarAcordos().map(function (a, i) {
                return '<option value="' + i + '"' + (String(i) === String(selecionado) ? ' selected' : '') + '>' +
                    esc(a.nome || ('Acordo ' + (i + 1))) + '</option>';
            }).join('');
    }

    function campoFiltro(acao, rotulo, tipo, valor, placeholder) {
        return '<div class="ponto-filtro-grupo"><label>' + esc(rotulo) + '</label>' +
            '<input type="' + tipo + '" data-ponto-action="' + acao + '" value="' + esc(valor) + '"' +
            (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '></div>';
    }

    function selectFiltro(acao, rotulo, opcoesHtml) {
        return '<div class="ponto-filtro-grupo"><label>' + esc(rotulo) + '</label>' +
            '<select data-ponto-action="' + acao + '">' + opcoesHtml + '</select></div>';
    }
    var _registroForm = null; // draft do formulário de registro (novo ou edição) | null
    var _eventoForm = null;   // draft do formulário de evento | null
    var _acordoForm = null;   // draft do formulário de acordo | null

    // Dias de férias por período aquisitivo: CLT (Art. 130) garante 30 dias corridos
    // na regra geral — não é configurável pelo usuário.
    var FERIAS_DIAS_CLT = 30;

    var MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    function renderizarPlaceholder(chave) {
        var rotulo = (SUBABAS.filter(function (s) { return s.chave === chave; })[0] || {}).rotulo || chave;
        return '<div class="ponto-placeholder">' +
            '<p>' + esc(rotulo) + ' — em construção (Fase 3 do plano de migração do Ponto).</p>' +
        '</div>';
    }

    // ── Helpers de formatação (leitura) ──
    function fmtData(iso) {
        if (!iso) return '—';
        var p = iso.split('-');
        return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso;
    }

    function fmtMes(m) {
        if (!m) return '';
        var p = m.split('-');
        var idx = Number(p[1]) - 1;
        return (MESES_PT[idx] || p[1]) + '/' + p[0];
    }

    function rotuloSnake(v) {
        return v ? esc(String(v).replace(/_/g, ' ')) : '—';
    }

    function rotuloStatus(s) {
        switch (s) {
            case 'ok': return 'OK';
            case 'extra': return 'Hora extra';
            case 'falta': return 'Falta/atraso';
            case 'sem_registro': return 'Sem registro';
            case 'erro_hora': return 'Erro de horário';
            default: return rotuloSnake(s);
        }
    }

    function mesesDisponiveis(registros) {
        var set = {};
        (registros || []).forEach(function (r) { if (r.data) set[r.data.slice(0, 7)] = true; });
        return Object.keys(set).sort().reverse();
    }

    function seletorMes(acao, meses, mesSelecionado) {
        return '<div class="ponto-filtro-mes"><label>Mês: <select data-ponto-action="' + acao + '">' +
            meses.map(function (m) {
                return '<option value="' + m + '"' + (m === mesSelecionado ? ' selected' : '') + '>' + fmtMes(m) + '</option>';
            }).join('') +
        '</select></label></div>';
    }

    // ── Helpers de formulário (Fase 4 — CRUD) ──
    function valorCampo(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function campoTexto(id, label, valor, tipo, extraClass) {
        tipo = tipo || 'text';
        return '<label class="ponto-campo' + (extraClass ? ' ' + extraClass : '') + '"><span>' + esc(label) + '</span>' +
            '<input type="' + tipo + '" id="' + id + '" value="' + esc(valor == null ? '' : valor) + '"></label>';
    }

    function campoSelect(id, label, opcoes, valorSelecionado) {
        return '<label class="ponto-campo"><span>' + esc(label) + '</span><select id="' + id + '">' +
            opcoes.map(function (o) {
                return '<option value="' + esc(o.valor) + '"' + (o.valor === valorSelecionado ? ' selected' : '') + '>' + esc(o.rotulo) + '</option>';
            }).join('') +
        '</select></label>';
    }

    // ── Sub-abas de leitura + escrita (Fase 3 e 4) ──

    function formEvento(draft) {
        var tipos = PontoStore.listarTiposEvento().map(function (t) { return { valor: t.id, rotulo: t.nome }; });
        var periodos = [{ valor: 'dia_todo', rotulo: 'Dia todo' }, { valor: 'matutino', rotulo: 'Matutino' }, { valor: 'vespertino', rotulo: 'Vespertino' }];
        var impactos = [{ valor: 'folga', rotulo: 'Folga' }, { valor: 'trabalho', rotulo: 'Trabalho' }];
        var opcoesAcd = [{ valor: '', rotulo: '— Nenhum —' }].concat(
            PontoStore.listarAcordos().map(function (a, i) { return { valor: String(i), rotulo: a.nome || ('Acordo ' + (i + 1)) }; })
        );
        return '<div class="ponto-form">' +
            campoSelect('pontoEvtTipo', 'Tipo', tipos, draft.tipoEvento) +
            campoTexto('pontoEvtDesc', 'Descrição', draft.descricaoEvento, 'text', 'ponto-campo-largo') +
            campoTexto('pontoEvtInicio', 'Início', draft.dataInicioEvento, 'date') +
            campoTexto('pontoEvtFim', 'Fim', draft.dataFimEvento, 'date') +
            campoSelect('pontoEvtPeriodo', 'Período', periodos, draft.periodo) +
            campoSelect('pontoEvtImpacto', 'Impacto', impactos, draft.impactoEvento) +
            campoSelect('pontoEvtAcordo', 'Acordo', opcoesAcd, draft.acordoIndex != null ? String(draft.acordoIndex) : '') +
            '<div class="ponto-form-acoes">' +
                '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="eventoSalvar">Salvar</button>' +
                '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="eventoCancelar">Cancelar</button>' +
            '</div>' +
        '</div>';
    }

    /** Aba Eventos — porte de renderizarEventos() do Ponto (tabela + filtros de acordo/tipo/datas). */
    function renderizarEventos() {
        var acordos = PontoStore.listarAcordos();
        var tipos = PontoStore.listarTiposEvento();
        var tiposMap = {};
        tipos.forEach(function (t) { tiposMap[t.id] = t; });

        var barra = '<div class="ponto-toolbar">' +
            selectFiltro('evtFiltroAcordo', 'Acordo', opcoesAcordo(_fEvt.acordo, 'Todos os acordos')) +
            selectFiltro('evtFiltroTipo', 'Tipo', '<option value="">Todos</option>' +
                tipos.map(function (t) {
                    return '<option value="' + esc(t.id) + '"' + (t.id === _fEvt.tipo ? ' selected' : '') + '>' + esc(t.nome) + '</option>';
                }).join('')) +
            campoFiltro('evtFiltroDe', 'De', 'date', _fEvt.de) +
            campoFiltro('evtFiltroAte', 'Até', 'date', _fEvt.ate) +
            '<div class="ponto-toolbar-acoes">' +
                (_eventoForm ? '' : '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="eventoNovo">➕ Novo Evento</button>') +
                '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="evtLimparFiltros">Limpar</button>' +
            '</div>' +
        '</div>';

        var formHtml = _eventoForm ? formEvento(_eventoForm) : '';

        var eventos = PontoStore.listarEventos().filter(function (e) {
            if (_fEvt.tipo && e.tipoEvento !== _fEvt.tipo) return false;
            if (_fEvt.de && e.dataFimEvento && e.dataFimEvento < _fEvt.de) return false;
            if (_fEvt.ate && e.dataInicioEvento && e.dataInicioEvento > _fEvt.ate) return false;
            if (_fEvt.acordo !== '') {
                var alvo = Number(_fEvt.acordo);
                var idx = (e.acordoIndex != null) ? e.acordoIndex : indiceAcordoDaData(acordos, e.dataInicioEvento);
                if (idx !== alvo) return false;
            }
            return true;
        }).sort(function (a, b) {
            return a.dataInicioEvento < b.dataInicioEvento ? -1 : (a.dataInicioEvento > b.dataInicioEvento ? 1 : 0);
        });

        if (!eventos.length) {
            return barra + formHtml + '<div class="ponto-placeholder"><p>Nenhum evento cadastrado.</p></div>';
        }

        var linhas = eventos.map(function (e) {
            var tipo = tiposMap[e.tipoEvento];
            var nomeAcordo = (e.acordoIndex != null && acordos[e.acordoIndex])
                ? (acordos[e.acordoIndex].nome || ('Acordo ' + (e.acordoIndex + 1))) : '';
            return '<tr>' +
                '<td><span class="evento-badge ' + esc(e.tipoEvento) + '">' + esc(tipo ? tipo.nome : e.tipoEvento) + '</span></td>' +
                '<td>' + esc(e.descricaoEvento) + '</td>' +
                '<td>' + esc(nomeAcordo) + '</td>' +
                '<td>' + fmtData(e.dataInicioEvento) + '</td>' +
                '<td>' + fmtData(e.dataFimEvento) + '</td>' +
                '<td>' + esc(LABEL_PERIODO[e.periodo] || e.periodo || 'Dia todo') + '</td>' +
                '<td>' + esc(e.impactoEvento) + '</td>' +
                '<td class="ponto-col-acoes">' +
                    '<button type="button" class="crm-btn-mini" data-ponto-action="eventoEditar" data-valor="' + esc(e.id) + '">Editar</button>' +
                    '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-ponto-action="eventoExcluir" data-valor="' + esc(e.id) + '">Excluir</button>' +
                '</td>' +
            '</tr>';
        }).join('');

        return barra + formHtml + '<div class="crm-lista-wrapper"><table class="crm-lista-table"><thead><tr>' +
            '<th>Tipo</th><th>Descrição</th><th>Acordo</th><th>Início</th><th>Fim</th><th>Período</th><th>Impacto</th><th>Ações</th>' +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
    }

    /**
     * Aba Férias — porte de renderizarPeriodosAquisitivosTable(): agrupa os
     * subperíodos por período aquisitivo, usa rowspan nas colunas do grupo e
     * calcula Total Dias / Dias Disponíveis a partir da cota fixa da CLT (30 dias).
     */
    function renderizarFerias() {
        var todos = PontoStore.listarPeriodosAquisitivos();
        if (!todos.length) return '<div class="ponto-placeholder"><p>Nenhum período aquisitivo salvo.</p></div>';

        var entitlement = FERIAS_DIAS_CLT;
        var MS_DIA = 24 * 60 * 60 * 1000;

        var grupos = {};
        todos.forEach(function (p) {
            var k = p.periodoIndex != null ? p.periodoIndex : 0;
            (grupos[k] = grupos[k] || []).push(p);
        });

        var linhas = Object.keys(grupos).sort(function (a, b) { return Number(a) - Number(b); }).map(function (chave) {
            var grupo = grupos[chave];
            var base = grupo[0];

            var comFerias = grupo.filter(function (p) { return p.feriasInicio && p.feriasFim; })
                .sort(function (a, b) { return (a.subIndex || 0) - (b.subIndex || 0); });

            // Sem nenhuma marcação ainda → mostra só o 1º período vazio.
            var lista = comFerias.length ? comFerias : [{
                id: base.id, periodoIndex: base.periodoIndex, inicio: base.inicio,
                termino: base.termino, limite: base.limite, subIndex: 1,
                feriasInicio: null, feriasFim: null, adto13: '', dias: null, documento: ''
            }];

            var totalConcedidos = 0;
            grupo.forEach(function (sub) {
                if (sub.feriasInicio && sub.feriasFim) {
                    var i = new Date(sub.feriasInicio), f = new Date(sub.feriasFim);
                    var dias = (sub.dias > 0) ? sub.dias : Math.floor((f - i) / MS_DIA) + 1;
                    if (dias > 0) totalConcedidos += dias;
                } else if (sub.dias > 0) {
                    totalConcedidos += sub.dias;
                }
            });
            var disponiveis = Math.max(0, entitlement - totalConcedidos);
            var rowspan = lista.length;

            var podeSolicitar = comFerias.length < MAX_FERIAS_SUBPERIODOS;

            return lista.map(function (r, idx) {
                var celulasGrupo = '';
                if (idx === 0) {
                    var faixaTexto = (base.inicio && base.termino)
                        ? (fmtData(base.inicio) + ' → ' + fmtData(base.termino))
                        : fmtData(base.inicio || base.termino);
                    var faixa = podeSolicitar
                        ? '<a href="#" class="ponto-link-ferias" data-ponto-action="feriasSolicitarAbrir" data-valor="' + esc(base.periodoIndex) + '" title="Clique para solicitar férias">' + faixaTexto + '</a>'
                        : faixaTexto;
                    celulasGrupo =
                        '<td rowspan="' + rowspan + '">' + faixa + '</td>' +
                        '<td rowspan="' + rowspan + '">' + fmtData(base.limite) + '</td>' +
                        '<td rowspan="' + rowspan + '">' + totalConcedidos + '</td>' +
                        '<td rowspan="' + rowspan + '" class="ponto-ferias-disp">' + disponiveis + '</td>';
                }
                var sub = (r.subIndex >= 1 && r.subIndex <= 3) ? r.subIndex : 1;
                var temFerias = !!(r.feriasInicio && r.feriasFim);

                return '<tr>' + celulasGrupo +
                    '<td>' + sub + 'º Período</td>' +
                    '<td>' + (r.feriasInicio ? fmtData(r.feriasInicio) : '') + '</td>' +
                    '<td>' + (r.feriasFim ? fmtData(r.feriasFim) : '') + '</td>' +
                    '<td>' + esc(r.adto13 || '') + '</td>' +
                    '<td>' + (r.dias != null ? esc(r.dias) : '') + '</td>' +
                    '<td>' + esc(r.documento || '') + '</td>' +
                    '<td class="ponto-col-acoes">' + (temFerias
                        ? '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-ponto-action="feriasRemover" data-valor="' + esc(r.id) + '">Remover</button>'
                        : '') + '</td>' +
                '</tr>';
            }).join('');
        }).join('');

        return '<div class="crm-lista-wrapper"><table class="crm-lista-table ponto-ferias-table"><thead><tr>' +
            '<th>Período Aquisitivo</th><th>Limite</th><th>Total Dias</th><th>Dias Disponíveis</th>' +
            '<th>Período</th><th>Férias Início</th><th>Férias Fim</th><th>Adto 13º</th><th>Dias</th>' +
            '<th>Documento</th><th>Ações</th>' +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
    }

    var MAX_FERIAS_SUBPERIODOS = 3;
    var _feriasModal = null; // { periodoIndex, subIndex, faixa, limite, disponiveis, inicio, fim, adto13 } | null

    /** Modal "Solicitar Férias" — porte de abrirModalSolicitarFerias()/confirmarSolicitacaoFerias() do Ponto. */
    function renderizarModalFerias() {
        if (!_feriasModal) return '';
        var m = _feriasModal;
        var diasCalc = '';
        if (m.inicio && m.fim) {
            var i = new Date(m.inicio), f = new Date(m.fim);
            if (!isNaN(i.getTime()) && !isNaN(f.getTime()) && f >= i) {
                diasCalc = 'Total: ' + (Math.floor((f - i) / 86400000) + 1) + ' dia(s)';
            }
        }
        return '<div class="ponto-modal-backdrop">' +
            '<div class="ponto-modal">' +
                '<div class="ponto-modal-header"><h4>Solicitar Férias</h4>' +
                    '<button type="button" class="ponto-modal-fechar" data-ponto-action="feriasSolicitarCancelar">×</button></div>' +
                '<div class="ponto-modal-corpo">' +
                    '<div class="ponto-modal-campo"><label>Período Aquisitivo:</label><span>' + m.faixa + '</span></div>' +
                    '<div class="ponto-modal-campo"><label>Limite de Concessão:</label><span>' + fmtData(m.limite) + '</span></div>' +
                    '<div class="ponto-modal-campo"><label>Dias Disponíveis:</label><strong>' + m.disponiveis + ' dias</strong></div>' +
                    '<div class="ponto-modal-campo"><label>Próximo Período:</label><strong class="ponto-modal-destaque">' + m.subIndex + 'º Período</strong></div>' +
                    '<hr class="ponto-modal-sep">' +
                    '<label class="ponto-modal-label">Data de Início:</label>' +
                    '<input type="date" id="pontoFeriasInicio" data-ponto-action="feriasDataMudou" value="' + esc(m.inicio) + '">' +
                    '<label class="ponto-modal-label">Data de Término:</label>' +
                    '<input type="date" id="pontoFeriasFim" data-ponto-action="feriasDataMudou" value="' + esc(m.fim) + '">' +
                    (diasCalc ? '<div class="ponto-modal-dias">' + diasCalc + '</div>' : '') +
                    '<label class="ponto-modal-label">Adiantamento 13º:</label>' +
                    '<select id="pontoFeriasAdto13">' +
                        '<option value=""' + (m.adto13 === '' ? ' selected' : '') + '>Não</option>' +
                        '<option value="sim"' + (m.adto13 === 'sim' ? ' selected' : '') + '>Sim</option>' +
                    '</select>' +
                '</div>' +
                '<div class="ponto-modal-rodape">' +
                    '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="feriasSolicitarCancelar">Cancelar</button>' +
                    '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="feriasSolicitarConfirmar">Confirmar Solicitação</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    var TIPO_ICONES_EVENTO = {
        ferias: '🏖️', feriado: '📅', afastamento: '🏥', viagem: '✈️',
        abono: '🟢', abono_acordo: '🟢', pagar_hora_acordo: '💰', outro: '📌'
    };

    /**
     * "Gerenciar Acordo" — porte do modalAcordo do Ponto (index-refatorado.html:788),
     * com as mesmas 4 abas (Resumo/Períodos/Regras/Abono e Pagar Hora). Cada tabela
     * de Períodos/Regras tem seu próprio mini-formulário "Novo X" abaixo, que vira
     * "Salvar X" quando uma linha existente está sendo editada — mesmo padrão do
     * original (editarPeriodoAcordo/adicionarPeriodoAcordo).
     */
    /** Modal "Gerenciar Acordo" — porte do modalAcordo do Ponto, com as mesmas 4 abas laterais. */
    function renderizarModalAcordo() {
        if (!_acordoForm) return '';
        var draft = _acordoForm;

        var abas = [
            { chave: 'resumo', rotulo: 'Resumo' },
            { chave: 'periodos', rotulo: 'Períodos' },
            { chave: 'regras', rotulo: 'Regras' },
            { chave: 'beneficios', rotulo: 'Abono/Pagar Hora' }
        ];
        var sidebar = '<div class="ponto-acd-sidebar">' + abas.map(function (ab) {
            return '<button type="button" class="ponto-acd-side-btn' + (draft._aba === ab.chave ? ' active' : '') + '" ' +
                'data-ponto-action="acordoTrocarAba" data-valor="' + ab.chave + '">' + esc(ab.rotulo) + '</button>';
        }).join('') + '</div>';

        var conteudo;
        if (draft._aba === 'periodos') conteudo = acordoPeriodosPanel(draft);
        else if (draft._aba === 'regras') conteudo = acordoRegrasPanel(draft);
        else if (draft._aba === 'beneficios') conteudo = acordoBeneficiosPanel(draft);
        else conteudo = acordoResumoPanel();

        return '<div class="ponto-modal-backdrop">' +
            '<div class="ponto-modal ponto-acd-modal">' +
                '<div class="ponto-modal-header"><h4>Gerenciar Acordo</h4>' +
                    '<button type="button" class="ponto-modal-fechar" data-ponto-action="acordoCancelar">×</button></div>' +
                '<div class="ponto-modal-corpo">' +
                    '<div class="ponto-modal-campo"><label>Nome do Acordo</label>' +
                        '<input type="text" id="pontoAcdNome" value="' + esc(draft.nome) + '"></div>' +
                    '<div class="ponto-acd-panels">' + sidebar + '<div class="ponto-acd-conteudo">' + conteudo + '</div></div>' +
                '</div>' +
                '<div class="ponto-modal-rodape">' +
                    '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="acordoCancelar">Cancelar</button>' +
                    '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="acordoSalvar">Salvar Acordo</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function acordoResumoPanel() {
        var passos = [
            ['Períodos', 'Defina os intervalos de vigência do acordo e quantos minutos extras por dia são acumulados.'],
            ['Regras de Horário', 'Configure o horário de entrada, tolerâncias e tempo de almoço para cada faixa de vigência.'],
            ['Abono / Pagar Hora', 'Defina a cota de abonos e horas extras remuneradas disponíveis neste acordo.']
        ];
        return '<div class="ponto-acd-resumo">' + passos.map(function (p, i) {
            return '<div class="ponto-acd-passo"><span>' + (i + 1) + '</span><div><strong>' + esc(p[0]) + '</strong><p>' + esc(p[1]) + '</p></div></div>';
        }).join('') + '</div>';
    }

    function acordoPeriodosPanel(draft) {
        var linhas = draft.periodos.map(function (p, i) {
            return '<tr>' +
                '<td>' + fmtData(p.inicio) + '</td><td>' + fmtData(p.fim) + '</td><td>' + (p.minutosExtras || 0) + ' min</td>' +
                '<td class="ponto-col-acoes">' +
                    '<button type="button" class="crm-btn-mini" data-ponto-action="acordoPeriodoEditar" data-valor="' + i + '">Editar</button>' +
                    '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-ponto-action="acordoPeriodoRemover" data-valor="' + i + '">Excluir</button>' +
                '</td>' +
            '</tr>';
        }).join('') || '<tr><td colspan="4" class="ponto-vazio">Nenhum período cadastrado</td></tr>';

        var editando = draft._periodoEditando != null;
        var base = editando ? draft.periodos[draft._periodoEditando] : { inicio: '', fim: '', minutosExtras: 0 };

        return '<h4>Períodos de Compensação</h4>' +
            '<div class="crm-lista-wrapper"><table class="crm-lista-table"><thead><tr>' +
                '<th>Início</th><th>Fim</th><th>Minutos Extras/dia</th><th>Ações</th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
            '<div class="ponto-subform-novo"><strong>' + (editando ? 'Editar Período' : 'Novo Período') + '</strong>' +
                '<div class="ponto-form">' +
                    campoTexto('pontoAcdNovoPerInicio', 'Início', base.inicio, 'date') +
                    campoTexto('pontoAcdNovoPerFim', 'Fim', base.fim, 'date') +
                    campoTexto('pontoAcdNovoPerExtras', 'Minutos extras/dia', base.minutosExtras, 'number') +
                '</div>' +
                '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="acordoPeriodoSalvar">' +
                    (editando ? 'Salvar Período' : '+ Adicionar Período') + '</button>' +
            '</div>';
    }

    function acordoRegrasPanel(draft) {
        var linhas = draft.regrasHorario.map(function (r, i) {
            return '<tr>' +
                '<td>' + fmtData(r.inicio) + '</td><td>' + fmtData(r.fim) + '</td><td>' + (r.minutosExtras || 0) + '</td>' +
                '<td>' + esc(r.inicioExpediente || '') + '</td><td>' + (r.almocoMin != null ? r.almocoMin : 60) + ' min</td>' +
                '<td>' + (r.tolAlmoco || 0) + ' min</td><td>' + (r.tolSaida || 0) + ' min</td>' +
                '<td>' + esc(r.tipo || '') + '</td><td>R$ ' + Number(r.vale || 0).toFixed(2) + '</td>' +
                '<td class="ponto-col-acoes">' +
                    '<button type="button" class="crm-btn-mini" data-ponto-action="acordoRegraEditar" data-valor="' + i + '">Editar</button>' +
                    '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-ponto-action="acordoRegraRemover" data-valor="' + i + '">Excluir</button>' +
                '</td>' +
            '</tr>';
        }).join('') || '<tr><td colspan="10" class="ponto-vazio">Nenhuma regra cadastrada</td></tr>';

        var editando = draft._regraEditando != null;
        var base = editando ? draft.regrasHorario[draft._regraEditando]
            : { inicio: '', fim: '', minutosExtras: 0, inicioExpediente: '', almocoMin: 60, tolAlmoco: 5, tolSaida: 5, tipo: '', vale: 0 };

        return '<h4>Regras de Horário</h4>' +
            '<div class="crm-lista-wrapper"><table class="crm-lista-table"><thead><tr>' +
                '<th>Início</th><th>Fim</th><th>Min Extras</th><th>Início Expediente</th><th>Almoço</th>' +
                '<th>Tol. Almoço</th><th>Tol. Saída</th><th>Tipo</th><th>Vale (R$)</th><th>Ações</th>' +
            '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
            '<div class="ponto-subform-novo"><strong>' + (editando ? 'Editar Regra' : 'Nova Regra') + '</strong>' +
                '<div class="ponto-form">' +
                    campoTexto('pontoAcdNovoRegInicio', 'Início da vigência', base.inicio, 'date') +
                    campoTexto('pontoAcdNovoRegFim', 'Fim da vigência', base.fim, 'date') +
                    campoTexto('pontoAcdNovoRegInicioExp', 'Horário de entrada', base.inicioExpediente, 'time') +
                    campoTexto('pontoAcdNovoRegExtras', 'Minutos extras por dia', base.minutosExtras, 'number') +
                    campoTexto('pontoAcdNovoRegAlmoco', 'Almoço (min)', base.almocoMin, 'number') +
                    campoTexto('pontoAcdNovoRegTolAlmoco', 'Tolerância almoço (min)', base.tolAlmoco, 'number') +
                    campoTexto('pontoAcdNovoRegTolSaida', 'Tolerância saída (min)', base.tolSaida, 'number') +
                    campoTexto('pontoAcdNovoRegTipo', 'Tipo de regra', base.tipo, 'text') +
                    campoTexto('pontoAcdNovoRegVale', 'Vale transporte (R$)', base.vale, 'number') +
                '</div>' +
                '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="acordoRegraSalvar">' +
                    (editando ? 'Salvar Regra' : '+ Adicionar Regra') + '</button>' +
            '</div>';
    }

    function acordoBeneficiosPanel(draft) {
        var uso = { usadoAbono: 0, restanteAbono: draft.qtdAbono || 0, usadoPagarHora: 0, restantePagarHora: draft.qtdPagarHora || 0 };
        if (draft.id) {
            var acordos = PontoStore.listarAcordos();
            var idx = acordos.findIndex(function (a) { return a.id === draft.id; });
            if (idx !== -1) {
                uso = PontoCalculos.calcularUsoBeneficiosAcordo(idx, acordos[idx], PontoStore.listarEventos(), PontoStore.listarRegistros(), acordos);
            }
        }
        return '<h4>Controle de Abono e Pagar Hora</h4>' +
            '<p class="ponto-hint">Defina a quantidade disponível de abono e pagar hora para este acordo. O sistema abate automaticamente conforme eventos forem criados.</p>' +
            '<div class="ponto-form">' +
                campoTexto('pontoAcdQtdAbono', 'Quantidade de Abono Disponível (meio-período, inteiro)', draft.qtdAbono, 'number') +
                campoTexto('pontoAcdQtdPagarHora', 'Quantidade de Pagar Hora Disponível (horas)', draft.qtdPagarHora, 'number') +
            '</div>' +
            '<p class="ponto-uso-beneficio">Abono — Utilizado: ' + uso.usadoAbono + ' meio-período(s) | Restante: ' + uso.restanteAbono + ' meio-período(s)</p>' +
            '<p class="ponto-uso-beneficio">Pagar Hora — Utilizado: ' + uso.usadoPagarHora + 'h | Restante: ' + uso.restantePagarHora + 'h</p>';
    }

    /** Lê o que existe no DOM (nome +, se a aba estiver aberta, as quantidades de benefício) de volta pro draft antes de qualquer ação que force um re-render. */
    function sincronizarAcordoDraft() {
        if (!_acordoForm) return;
        var nomeEl = document.getElementById('pontoAcdNome');
        if (nomeEl) _acordoForm.nome = nomeEl.value;
        var qa = document.getElementById('pontoAcdQtdAbono');
        if (qa) _acordoForm.qtdAbono = Number(qa.value) || 0;
        var qp = document.getElementById('pontoAcdQtdPagarHora');
        if (qp) _acordoForm.qtdPagarHora = Number(qp.value) || 0;
    }

    function acordoSecaoAberta(id, secao, abrePorPadrao) {
        var chave = id + ':' + secao;
        return (chave in _acordoSecoesAbertas) ? _acordoSecoesAbertas[chave] : !!abrePorPadrao;
    }

    function secaoAcordo(idAcordo, chave, titulo, contagem, conteudoHtml, abrePorPadrao) {
        var aberta = acordoSecaoAberta(idAcordo, chave, abrePorPadrao);
        return '<div class="acv2-section' + (aberta ? ' acv2-section-open' : '') + '">' +
            '<button type="button" class="acv2-section-toggle" data-ponto-action="acordoSecaoToggle" ' +
                'data-acordo="' + esc(idAcordo) + '" data-secao="' + chave + '" data-padrao="' + (abrePorPadrao ? '1' : '0') + '">' +
                '<span class="acv2-section-titulo">' + esc(titulo) + '</span>' +
                '<span class="acv2-section-count">' + (contagem != null ? contagem : '') + '</span>' +
                '<svg class="acv2-section-chevron" viewBox="0 0 20 20" fill="currentColor" width="14" height="14">' +
                    '<path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd"/></svg>' +
            '</button>' +
            '<div class="acv2-section-body">' + conteudoHtml + '</div>' +
        '</div>';
    }

    function renderizarAcordos() {
        var acoesTopo = '<div class="ponto-toolbar">' +
            '<div class="ponto-toolbar-acoes">' +
                (_acordoForm ? '' : '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="acordoNovo">+ Novo Acordo</button>') +
            '</div>' +
            '<div class="ponto-filtro-grupo ponto-filtro-cresce"><label>Buscar</label>' +
                '<input type="text" data-ponto-action="acordoBuscar" value="' + esc(_buscaAcordos) + '" placeholder="Buscar acordo por nome..."></div>' +
        '</div>';
        var acordos = PontoStore.listarAcordos();
        if (!acordos.length) return acoesTopo + '<div class="ponto-placeholder"><p>Nenhum acordo cadastrado ainda.</p></div>';

        var hoje = new Date().toISOString().slice(0, 10);
        var eventos = PontoStore.listarEventos();
        var busca = _buscaAcordos.trim().toLowerCase();

        // Mais novo primeiro, preservando o índice original (getAcordosSortedByNewest do Ponto).
        var ordenados = acordos.map(function (a, i) {
            var ref = (a.periodos || []).reduce(function (acc, p) {
                return (p.inicio && (!acc || p.inicio > acc)) ? p.inicio : acc;
            }, null);
            return { a: a, i: i, ref: ref || '' };
        }).sort(function (x, y) { return x.ref < y.ref ? 1 : (x.ref > y.ref ? -1 : 0); })
          .filter(function (it) {
              return !busca || String(it.a.nome || ('Acordo ' + (it.i + 1))).toLowerCase().indexOf(busca) !== -1;
          });

        if (!ordenados.length) {
            return acoesTopo + '<div class="ponto-placeholder"><p>Nenhum acordo encontrado para "' + esc(_buscaAcordos) + '".</p></div>';
        }

        var vigente = function (x) { return x.inicio <= hoje && (!x.fim || x.fim >= hoje); };

        var cards = ordenados.map(function (it) {
            var a = it.a;
            var periodoAtivo = (a.periodos || []).filter(vigente)[0];
            var regraAtiva = (a.regrasHorario || []).filter(vigente)[0];
            var eventosAcordo = eventos.filter(function (ev) { return ev.acordoIndex === it.i; });

            var stats = regraAtiva ? '<div class="acv2-stats">' +
                '<div class="acv2-stat"><span class="acv2-stat-label">Entrada</span><span class="acv2-stat-value">' + esc(regraAtiva.inicioExpediente || '—') + '</span></div>' +
                '<div class="acv2-stat"><span class="acv2-stat-label">Almoço</span><span class="acv2-stat-value">' + (regraAtiva.almocoMin != null ? regraAtiva.almocoMin + ' min' : '—') + '</span></div>' +
                '<div class="acv2-stat"><span class="acv2-stat-label">Extras/dia</span><span class="acv2-stat-value">+' + (regraAtiva.minutosExtras || 0) + ' min</span></div>' +
                '<div class="acv2-stat"><span class="acv2-stat-label">Eventos</span><span class="acv2-stat-value">' + eventosAcordo.length + '</span></div>' +
            '</div>' : '';

            var periodos = a.periodos || [];
            var htmlPeriodos = periodos.length
                ? periodos.map(function (p) {
                    return '<div class="acv2-row' + (vigente(p) ? ' acv2-row-ativo' : '') + '">' +
                        '<span>' + fmtData(p.inicio) + ' → ' + fmtData(p.fim) + '</span>' +
                        '<span class="acv2-chip">' + (p.minutosExtras || 0) + ' min/dia</span></div>';
                }).join('')
                : '<p class="acv2-empty-section">Nenhum período cadastrado</p>';

            var regras = a.regrasHorario || [];
            var htmlRegras = regras.length
                ? regras.map(function (r) {
                    var tol = (r.tolAlmoco || r.tolSaida) ? ' · tol: ' + (r.tolAlmoco || 0) + '/' + (r.tolSaida || 0) + ' min' : '';
                    return '<div class="acv2-row' + (vigente(r) ? ' acv2-row-ativo' : '') + '">' +
                        '<div><span>' + fmtData(r.inicio) + ' → ' + fmtData(r.fim) + '</span>' +
                        '<span class="acv2-row-sub">' + esc(r.inicioExpediente || '') + ' · almoço ' + (r.almocoMin != null ? r.almocoMin : 60) + ' min' + tol + '</span></div>' +
                        '<span class="acv2-chip">+' + (r.minutosExtras || 0) + ' min/dia</span></div>';
                }).join('')
                : '<p class="acv2-empty-section">Nenhuma regra cadastrada</p>';

            var htmlBeneficios = '';
            if (a.qtdAbono > 0 || a.qtdPagarHora > 0) {
                var uso = PontoCalculos.calcularUsoBeneficiosAcordo(it.i, a, eventos, PontoStore.listarRegistros(), acordos);
                if (a.qtdAbono > 0) {
                    var pctA = Math.min(100, Math.round((uso.usadoAbono / a.qtdAbono) * 100));
                    var esgA = uso.restanteAbono <= 0;
                    htmlBeneficios += '<div class="acv2-beneficio"><div class="acv2-beneficio-header">' +
                        '<span class="acv2-beneficio-label">Abono (meio-períodos)</span>' +
                        '<span class="acv2-beneficio-nums' + (esgA ? ' acv2-esgotado' : '') + '">' + uso.usadoAbono + ' / ' + a.qtdAbono + ' usados</span></div>' +
                        '<div class="acv2-progress"><div class="acv2-progress-bar' + (esgA ? ' acv2-progress-danger' : '') + '" style="width:' + pctA + '%"></div></div></div>';
                }
                if (a.qtdPagarHora > 0) {
                    var pctP = Math.min(100, Math.round((uso.usadoPagarHora / a.qtdPagarHora) * 100));
                    var esgP = uso.restantePagarHora <= 0;
                    htmlBeneficios += '<div class="acv2-beneficio"><div class="acv2-beneficio-header">' +
                        '<span class="acv2-beneficio-label">Pagar Hora</span>' +
                        '<span class="acv2-beneficio-nums' + (esgP ? ' acv2-esgotado' : '') + '">' + uso.usadoPagarHora + 'h / ' + a.qtdPagarHora + 'h usados</span></div>' +
                        '<div class="acv2-progress"><div class="acv2-progress-bar' + (esgP ? ' acv2-progress-danger' : '') + '" style="width:' + pctP + '%"></div></div></div>';
                }
            }

            var htmlEventos = eventosAcordo.length
                ? eventosAcordo.map(function (ev) {
                    var icone = TIPO_ICONES_EVENTO[ev.tipoEvento] || '📌';
                    var fim = (ev.dataFimEvento && ev.dataFimEvento !== ev.dataInicioEvento) ? (' → ' + fmtData(ev.dataFimEvento)) : '';
                    return '<div class="acv2-row acv2-row-evento">' +
                        '<span class="acv2-evento-tipo">' + icone + ' ' + esc(ev.tipoEvento) + '</span>' +
                        '<span class="acv2-evento-desc">' + esc(ev.descricaoEvento) + '</span>' +
                        '<span class="acv2-evento-data">' + fmtData(ev.dataInicioEvento) + fim + '</span></div>';
                }).join('')
                : '<p class="acv2-empty-section">Nenhum evento vinculado</p>';

            var secoes = secaoAcordo(a.id, 'periodos', 'Períodos de Compensação', periodos.length, htmlPeriodos, periodos.length > 0) +
                secaoAcordo(a.id, 'regras', 'Regras de Horário', regras.length, htmlRegras, regras.length > 0) +
                (htmlBeneficios ? secaoAcordo(a.id, 'beneficios', 'Abono / Pagar Hora', null, htmlBeneficios, false) : '') +
                secaoAcordo(a.id, 'eventos', 'Eventos e Feriados', eventosAcordo.length, htmlEventos, false);

            return '<div class="acordo-card-v2">' +
                '<div class="acv2-header">' +
                    '<div class="acv2-header-left">' +
                        '<span class="acv2-titulo">' + esc(a.nome || ('Acordo ' + (it.i + 1))) + '</span>' +
                        '<span class="acv2-badge ' + (periodoAtivo ? 'acv2-badge-active">Vigente' : 'acv2-badge-inactive">Encerrado') + '</span>' +
                    '</div>' +
                    '<div class="acv2-header-actions">' +
                        '<button type="button" class="crm-btn-mini" data-ponto-action="acordoEditar" data-valor="' + esc(a.id) + '">Editar</button>' +
                        '<button type="button" class="crm-btn-mini" data-ponto-action="acordoNovoEvento" data-valor="' + esc(a.id) + '">+ Evento</button>' +
                        '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-ponto-action="acordoExcluir" data-valor="' + esc(a.id) + '">Excluir</button>' +
                    '</div>' +
                '</div>' + stats +
                '<div class="acv2-sections">' + secoes + '</div>' +
            '</div>';
        }).join('');

        return acoesTopo + '<div class="ponto-acordos-lista">' + cards + '</div>';
    }

    // Mesmos 4 grupos e rótulos do select "Tipo" do modalRegistro original (index-refatorado.html).
    var TIPOS_ATESTADO_MEDICO = ['afastamento', 'comparecimento_matutino', 'comparecimento_vespertino'];
    // Abono (sem acordo) também é um período sem batida real — preenche horário padrão como
    // o atestado, pra não ficar com Retorno Almoço/Saída em branco. Abono Acordo e Pagar Hora
    // Acordo ficam de fora: são descontados de uma cota do acordo e usam os horários reais
    // batidos no dia, não um horário padrão preenchido automaticamente.
    var TIPOS_COM_HORARIO_PADRAO = TIPOS_ATESTADO_MEDICO.concat([
        'abono_matutino', 'abono_vespertino', 'abono_dia_todo'
    ]);
    var GRUPOS_ATESTADO = [
        { rotulo: 'Atestado Médico', opcoes: [
            ['afastamento', 'Atestado de Afastamento (dia todo)'],
            ['comparecimento_matutino', 'Atestado de Comparecimento — Manhã'],
            ['comparecimento_vespertino', 'Atestado de Comparecimento — Tarde']
        ] },
        { rotulo: 'Abono', opcoes: [
            ['abono_matutino', 'Abono — Manhã (saída antecipada ou entrada tarde)'],
            ['abono_vespertino', 'Abono — Tarde (saída antecipada)'],
            ['abono_dia_todo', 'Abono — Dia todo']
        ] },
        { rotulo: 'Abono Acordo', opcoes: [
            ['abono_acordo_matutino', 'Abono Acordo — Manhã'],
            ['abono_acordo_vespertino', 'Abono Acordo — Tarde'],
            ['abono_acordo_dia_todo', 'Abono Acordo — Dia todo']
        ] },
        { rotulo: 'Pagar Hora Acordo', opcoes: [
            ['pagar_hora_acordo_matutino', 'Pagar Hora Acordo — Manhã'],
            ['pagar_hora_acordo_vespertino', 'Pagar Hora Acordo — Tarde'],
            ['pagar_hora_acordo_dia_todo', 'Pagar Hora Acordo — Dia todo']
        ] }
    ];

    // Texto explicativo abaixo do select, por tipo — porte de _atualizarInfoAtestado() do Ponto.
    var INFO_ATESTADO = {
        afastamento: { icone: '🏥', texto: 'Horários reais preservados. Dia inteiro considerado trabalhado — <strong>saldo zero</strong>.', abrev: 'Ates. Afast.' },
        comparecimento_matutino: { icone: '🌅', texto: 'Horários reais preservados. No cálculo, a <strong>entrada é tratada como 07:45</strong>.', abrev: 'Ates. Comp.' },
        comparecimento_vespertino: { icone: '🌇', texto: 'Horários reais preservados. <strong>Jornada completa considerada</strong> — saldo zero.', abrev: 'Ates. Comp.' },
        abono_matutino: { icone: '🟢', texto: 'Período da manhã <strong>abonado</strong> — saldo zero.', abrev: 'Abono' },
        abono_vespertino: { icone: '🟢', texto: 'Período da tarde <strong>abonado</strong> — saldo zero.', abrev: 'Abono' },
        abono_dia_todo: { icone: '🟢', texto: 'Dia inteiro <strong>abonado</strong> — saldo zero.', abrev: 'Abono' },
        abono_acordo_matutino: { icone: '🤝', texto: 'Período da manhã <strong>abonado pelo acordo</strong> — desconta um meio-período da cota de abonos.', abrev: 'Abono Acordo' },
        abono_acordo_vespertino: { icone: '🤝', texto: 'Período da tarde <strong>abonado pelo acordo</strong> — desconta um meio-período da cota de abonos.', abrev: 'Abono Acordo' },
        abono_acordo_dia_todo: { icone: '🤝', texto: 'Dia inteiro <strong>abonado pelo acordo</strong> — desconta um dia inteiro da cota de abonos.', abrev: 'Abono Acordo' },
        pagar_hora_acordo_matutino: { icone: '⏱️', texto: 'Período da manhã marcado como <strong>pagar hora (acordo)</strong> — saldo negativo no período.', abrev: 'Pagar Hora' },
        pagar_hora_acordo_vespertino: { icone: '⏱️', texto: 'Período da tarde marcado como <strong>pagar hora (acordo)</strong> — saldo negativo no período.', abrev: 'Pagar Hora' },
        pagar_hora_acordo_dia_todo: { icone: '⏱️', texto: 'Dia inteiro marcado como <strong>pagar hora (acordo)</strong> — saldo negativo no dia.', abrev: 'Pagar Hora' }
    };

    var DIAS_SEMANA_COMPLETO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

    function diaSemanaCompleto(iso) {
        var p = (iso || '').split('-');
        if (p.length !== 3) return '';
        var dow = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
        return DIAS_SEMANA_COMPLETO[dow] || '';
    }

    /**
     * Horário padrão do dia (entrada do acordo ativo, ou 07:45; almoço do acordo,
     * ou 60min; carga = 8h + extras do acordo) — mesma convenção usada pelo
     * cálculo de comparecimento_matutino em ponto-calculos.js.
     */
    function horarioPadraoDoDia(dataIso) {
        var acordo = PontoCalculos.getAcordoByData(PontoStore.listarAcordos(), dataIso);
        var regra = PontoCalculos.getRegraHorarioForDay(acordo, dataIso);
        return {
            entradaPadrao: (regra && regra.inicioExpediente) || '07:45',
            almocoMin: (regra && regra.almocoMin != null) ? regra.almocoMin : 60,
            carga: 480 + ((regra && regra.minutosExtras) || 0)
        };
    }

    /**
     * Preenche entrada/saídaAlmoço/retornoAlmoço/saída do registro em edição
     * pro dia bater com a carga padrão do acordo. Se nada estiver preenchido,
     * usa o dia padrão inteiro (entrada padrão → carga/2 → almoço → carga/2).
     * Se algo já estiver preenchido, mantém e completa o resto em torno disso.
     */
    function preencherHorarioPadraoAtestado(d) {
        if (!d || !d.data) return;
        var p = horarioPadraoDoDia(d.data);
        var metade = p.carga / 2;
        var min = PontoCalculos.timeToMinutes;
        var fmt = PontoCalculos.minutosParaHHMM;

        var entrada = d.entrada ? min(d.entrada) : null;
        var saidaAlmoco = d.saidaAlmoco ? min(d.saidaAlmoco) : null;
        var retornoAlmoco = d.retornoAlmoco ? min(d.retornoAlmoco) : null;
        var saida = d.saida ? min(d.saida) : null;

        if (entrada == null && saidaAlmoco == null && retornoAlmoco == null && saida == null) {
            entrada = min(p.entradaPadrao);
            saidaAlmoco = entrada + metade;
            retornoAlmoco = saidaAlmoco + p.almocoMin;
            saida = retornoAlmoco + metade;
        } else {
            if (entrada == null) entrada = (saidaAlmoco != null) ? saidaAlmoco - metade : min(p.entradaPadrao);
            if (saida == null) {
                // O período da manhã já registrado (entrada→saída almoço) pode não bater
                // exatamente com metade da carga — a tarde precisa completar o que falta
                // pra fechar a carga do dia, não repetir metade às cegas.
                var manhaTrabalhada = (entrada != null && saidaAlmoco != null) ? (saidaAlmoco - entrada) : metade;
                var tardeNecessaria = Math.max(0, p.carga - manhaTrabalhada);
                if (retornoAlmoco != null) saida = retornoAlmoco + tardeNecessaria;
                else if (saidaAlmoco != null) saida = saidaAlmoco + p.almocoMin + tardeNecessaria;
                else saida = entrada + metade + p.almocoMin + metade;
            }
            if (saidaAlmoco == null || retornoAlmoco == null) {
                var duracaoAlmoco = Math.min(p.almocoMin, Math.max(0, saida - entrada));
                if (saidaAlmoco == null && retornoAlmoco == null) {
                    saidaAlmoco = entrada + (saida - entrada - duracaoAlmoco) / 2;
                    retornoAlmoco = saidaAlmoco + duracaoAlmoco;
                } else if (saidaAlmoco == null) {
                    saidaAlmoco = retornoAlmoco - duracaoAlmoco;
                } else {
                    retornoAlmoco = saidaAlmoco + duracaoAlmoco;
                }
            }
        }

        d.entrada = fmt(entrada);
        d.saidaAlmoco = fmt(saidaAlmoco);
        d.retornoAlmoco = fmt(retornoAlmoco);
        d.saida = fmt(saida);
    }

    /** Lê todos os campos do modal de volta pro draft antes de qualquer ação que force um re-render (troca de data/tipo). */
    function sincronizarRegistroForm() {
        if (!_registroForm) return;
        _registroForm.data = valorCampo('pontoRegData');
        _registroForm.entrada = valorCampo('pontoRegEntrada');
        _registroForm.saidaAlmoco = valorCampo('pontoRegSaidaAlmoco');
        _registroForm.retornoAlmoco = valorCampo('pontoRegRetornoAlmoco');
        _registroForm.saida = valorCampo('pontoRegSaida');
        _registroForm.tipoAtestado = valorCampo('pontoRegAtestado');
        _registroForm.observacoes = valorCampo('pontoRegObs');
    }

    /** Modal "Registro de Ponto" — porte de abrirModalRegistro()/abrirEdicaoDiaTimesheet() do Ponto. Abre tanto pelas ações da aba Registros quanto ao clicar numa célula de dia na Folha de Ponto. */
    function renderizarModalRegistro() {
        if (!_registroForm) return '';
        var d = _registroForm;

        var opcoesHtml = '<option value=""' + (!d.tipoAtestado ? ' selected' : '') + '>— Nenhuma —</option>' +
            GRUPOS_ATESTADO.map(function (g) {
                return '<optgroup label="' + esc(g.rotulo) + '">' + g.opcoes.map(function (o) {
                    return '<option value="' + o[0] + '"' + (d.tipoAtestado === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
                }).join('') + '</optgroup>';
            }).join('');

        var info = d.tipoAtestado && INFO_ATESTADO[d.tipoAtestado];

        return '<div class="ponto-modal-backdrop">' +
            '<div class="ponto-modal ponto-mreg">' +
                '<div class="ponto-modal-header"><h4>🕐 Registro de Ponto</h4>' +
                    '<button type="button" class="ponto-modal-fechar" data-ponto-action="registroCancelar">×</button></div>' +
                '<div class="ponto-modal-corpo">' +
                    '<div class="ponto-mreg-date-row">' +
                        '<div class="ponto-modal-campo ponto-mreg-date-campo"><label>Data</label>' +
                            '<input type="date" id="pontoRegData" data-ponto-action="registroDataMudou" value="' + esc(d.data) + '"></div>' +
                        '<div class="ponto-mreg-weekday">' + esc(diaSemanaCompleto(d.data)) + '</div>' +
                    '</div>' +
                    '<div class="ponto-mreg-block">' +
                        '<div class="ponto-mreg-block-label">🕐 Horários</div>' +
                        '<div class="ponto-mreg-times-grid">' +
                            '<div class="ponto-modal-campo"><label>Entrada</label><input type="time" id="pontoRegEntrada" value="' + esc(d.entrada) + '"></div>' +
                            '<div class="ponto-modal-campo"><label>Saída almoço</label><input type="time" id="pontoRegSaidaAlmoco" value="' + esc(d.saidaAlmoco) + '"></div>' +
                            '<div class="ponto-modal-campo"><label>Retorno almoço</label><input type="time" id="pontoRegRetornoAlmoco" value="' + esc(d.retornoAlmoco) + '"></div>' +
                            '<div class="ponto-modal-campo"><label>Saída</label><input type="time" id="pontoRegSaida" value="' + esc(d.saida) + '"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="ponto-mreg-block">' +
                        '<div class="ponto-mreg-block-label">📄 Justificativa</div>' +
                        '<div class="ponto-modal-campo"><label>Tipo</label>' +
                            '<select id="pontoRegAtestado" data-ponto-action="registroTipoMudou">' + opcoesHtml + '</select></div>' +
                        (info ? '<div class="ponto-mreg-info"><span>' + info.icone + '</span><span>' + info.texto + '</span></div>' : '') +
                    '</div>' +
                    '<div class="ponto-modal-campo"><label>Observações</label>' +
                        '<textarea id="pontoRegObs" rows="2" placeholder="Opcional...">' + esc(d.observacoes) + '</textarea></div>' +
                '</div>' +
                '<div class="ponto-modal-rodape">' +
                    '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="registroCancelar">Cancelar</button>' +
                    '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="registroSalvar">Salvar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    /**
     * Aba Registros — porte de renderizarTabelaRegistros(): filtros de acordo,
     * período, justificativa, saldo e observação; Total/Saldo calculados por
     * dia; badges de justificativa; fins de semana destacados.
     */
    function renderizarRegistros() {
        _registrosParaRenderizarLazy = [];
        var acordos = PontoStore.listarAcordos();
        var todos = PontoStore.listarRegistros();

        var justificativasUsadas = {};
        todos.forEach(function (r) { if (r.tipoAtestado) justificativasUsadas[r.tipoAtestado] = true; });

        var barra = '<div class="ponto-toolbar">' +
            selectFiltro('regFiltroAcordo', 'Acordo', opcoesAcordo(_fReg.acordo, 'Todos os acordos')) +
            campoFiltro('regFiltroDe', 'De', 'date', _fReg.de) +
            campoFiltro('regFiltroAte', 'Até', 'date', _fReg.ate) +
            selectFiltro('regFiltroJusti', 'Justificativa', '<option value="">Todos</option>' +
                Object.keys(justificativasUsadas).map(function (t) {
                    return '<option value="' + esc(t) + '"' + (t === _fReg.justificativa ? ' selected' : '') + '>' +
                        esc(LABEL_ATESTADO[t] || t.replace(/_/g, ' ')) + '</option>';
                }).join('')) +
            selectFiltro('regFiltroSaldo', 'Saldo',
                ['', 'positivo', 'negativo', 'zero'].map(function (v) {
                    var rot = { '': 'Todos', positivo: 'Positivo ▲', negativo: 'Negativo ▼', zero: 'Zerado' }[v];
                    return '<option value="' + v + '"' + (v === _fReg.saldo ? ' selected' : '') + '>' + rot + '</option>';
                }).join('')) +
            '<div class="ponto-filtro-grupo ponto-filtro-cresce"><label>Observação</label>' +
                '<input type="text" data-ponto-action="regFiltroObs" value="' + esc(_fReg.obs) + '" placeholder="Buscar..."></div>' +
            '<div class="ponto-toolbar-acoes">' +
                (_registroForm ? '' : '<button type="button" class="btn-primary crm-btn-mini" data-ponto-action="registroNovo">+ Novo Registro</button>') +
                '<button type="button" class="btn-secondary crm-btn-mini" data-ponto-action="regLimparFiltros">Limpar</button>' +
            '</div>' +
        '</div>';

        if (!todos.length) return barra + '<div class="ponto-placeholder"><p>Nenhum registro de ponto.</p></div>';

        var obsBusca = _fReg.obs.trim().toLowerCase();
        var registros = todos.filter(function (r) {
            if (!r.data) return false;
            if (_fReg.de && r.data < _fReg.de) return false;
            if (_fReg.ate && r.data > _fReg.ate) return false;
            if (_fReg.justificativa && r.tipoAtestado !== _fReg.justificativa) return false;
            if (obsBusca && String(r.observacoes || '').toLowerCase().indexOf(obsBusca) === -1) return false;
            if (_fReg.acordo !== '' && indiceAcordoDaData(acordos, r.data) !== Number(_fReg.acordo)) return false;
            if (_fReg.saldo) {
                var s = PontoStore.calcularDia(r.data).saldo;
                if (_fReg.saldo === 'positivo' && !(s > 0)) return false;
                if (_fReg.saldo === 'negativo' && !(s < 0)) return false;
                if (_fReg.saldo === 'zero' && s !== 0) return false;
            }
            return true;
        }).sort(function (a, b) { return a.data < b.data ? -1 : (a.data > b.data ? 1 : 0); });

        if (!registros.length) {
            return barra + '<div class="ponto-placeholder"><p>Nenhum registro para os filtros aplicados.</p></div>';
        }

        // As linhas em si são inseridas em lotes por montarRegistrosLazy(), chamada
        // por renderizar() logo após este HTML entrar no DOM — ver comentário lá.
        // Sem isso, anos de registros diários (um histórico que só cresce) travariam
        // a tela inteira a cada troca de filtro, como acontecia com a lista de
        // produtos antes do LazyLoader (ver app2.js, _renderUnidade).
        _registrosParaRenderizarLazy = registros;

        return barra + '<div class="crm-lista-wrapper"><table class="crm-lista-table rp-table"><thead><tr>' +
            '<th>Data</th><th>Entrada</th><th>Saída Almoço</th><th>Retorno Almoço</th><th>Saída</th>' +
            '<th>Justificativa</th><th>Total</th><th>Saldo</th><th>Observações</th><th>Ações</th>' +
        '</tr></thead><tbody id="pontoRegistrosBody"></tbody></table></div>';
    }

    var _horaRegistro = function (h) {
        return h ? '<span class="rp-hora">' + esc(h) + '</span>' : '<span class="rp-hora rp-hora-vazia">—</span>';
    };

    // Constrói o <tr> de uma linha de registro como elemento DOM (não string),
    // para poder ser inserido incrementalmente por LazyLoader.render — mesmo
    // padrão de _renderLinhaProduto em app2.js. Conteúdo de cada célula é
    // idêntico ao que a versão anterior (string + join) produzia.
    function _renderLinhaRegistro(r) {
        var calc = PontoStore.calcularDia(r.data);
        var clsSaldo = calc.saldo > 0 ? 'saldo-positivo' : (calc.saldo < 0 ? 'saldo-negativo' : '');

        var justi = '';
        if (r.tipoAtestado) {
            justi = '<span class="reg-badge ' + (BADGE_ATESTADO[r.tipoAtestado] || '') + '">' +
                esc(LABEL_ATESTADO[r.tipoAtestado] || r.tipoAtestado) + '</span>';
        } else if (r.periodoEvento) {
            var rot = { matutino: '☀️ Mat.', vespertino: '🌙 Ves.', dia_todo: '⛶ Todo' }[r.periodoEvento] || r.periodoEvento;
            justi = '<span class="reg-badge">' + esc(rot) + '</span>';
        }

        var dsem = diaSemanaDe(r.data);
        var fds = (dsem === 'Sáb' || dsem === 'Dom');

        var tr = document.createElement('tr');
        if (fds) tr.className = 'rp-tr-fds';
        tr.innerHTML =
            '<td class="rp-td-data"><span class="rp-data-dia">' + fmtData(r.data) + '</span>' +
                '<span class="rp-data-dsem' + (fds ? ' rp-data-fds' : '') + '">' + dsem + '</span></td>' +
            '<td>' + _horaRegistro(r.entrada) + '</td>' +
            '<td>' + _horaRegistro(r.saidaAlmoco) + '</td>' +
            '<td>' + _horaRegistro(r.retornoAlmoco) + '</td>' +
            '<td>' + _horaRegistro(r.saida) + '</td>' +
            '<td class="rp-td-justi">' + justi + '</td>' +
            '<td>' + PontoCalculos.minutosParaHHMM(calc.trabalhadas) + '</td>' +
            '<td>' + (calc.saldo
                ? '<span class="rp-saldo-chip ' + clsSaldo + '">' + PontoCalculos.minutosParaHHMM(calc.saldo) + '</span>'
                : '<span class="rp-saldo-chip rp-saldo-zero">—</span>') + '</td>' +
            '<td class="rp-td-obs" title="' + esc(r.observacoes || '') + '">' + esc(r.observacoes || '') + '</td>' +
            '<td class="ponto-col-acoes">' +
                '<button type="button" class="crm-btn-mini" data-ponto-action="registroEditar" data-valor="' + esc(r.data) + '">Editar</button>' +
                '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-ponto-action="registroExcluir" data-valor="' + esc(r.data) + '">Excluir</button>' +
            '</td>';
        return tr;
    }

    // Chamada por renderizar() depois que o HTML de renderizarRegistros() já está
    // no DOM (o <tbody id="pontoRegistrosBody"> precisa existir de verdade para o
    // IntersectionObserver do LazyLoader observar a sentinela). Fora da sub-aba
    // "registros" o elemento não existe e a função não faz nada.
    function montarRegistrosLazy() {
        var tbody = document.getElementById('pontoRegistrosBody');
        if (!tbody) return;
        var registros = _registrosParaRenderizarLazy;
        if (!registros || !registros.length) return;

        if (window.LazyLoader) {
            LazyLoader.render(tbody, registros, function (r) { tbody.appendChild(_renderLinhaRegistro(r)); }, {
                chunkSize: 50,
                criarSentinela: function (restantes) {
                    var tr = document.createElement('tr');
                    tr.className = 'lazy-sentinela';
                    var td = document.createElement('td');
                    td.colSpan = 10;
                    td.style.cssText = 'text-align:center;padding:12px;color:#94a3b8;font-size:0.8rem';
                    td.textContent = 'Carregando mais registros... (' + restantes + ' restante' + (restantes !== 1 ? 's' : '') + ')';
                    tr.appendChild(td);
                    return tr;
                }
            });
        } else {
            // LazyLoader não carregou por algum motivo: cai no comportamento antigo
            // (tudo de uma vez) em vez de deixar a tabela vazia.
            registros.forEach(function (r) { tbody.appendChild(_renderLinhaRegistro(r)); });
        }
    }

    /**
     * Folha de Ponto = o timesheet em grade do Ponto original (um bloco por mês
     * do ano fiscal do acordo). Delegado a ponto-timesheet.js, que é o porte
     * fiel de gerarTimesheetAcordo().
     */
    function renderizarFolha() {
        if (!window.PontoTimesheet) return '<div class="ponto-placeholder"><p>Módulo de timesheet não carregado.</p></div>';
        return PontoTimesheet.renderizar(_acordoTimesheet);
    }

    function renderizarConteudoSubaba(chave) {
        switch (chave) {
            case 'folha': return renderizarFolha();
            case 'registros': return renderizarRegistros();
            case 'acordos': return renderizarAcordos();
            case 'eventos': return renderizarEventos();
            case 'ferias': return renderizarFerias();
            default: return renderizarPlaceholder(chave);
        }
    }

    /**
     * Migração única: registros já salvos com justificativa (tipoAtestado) tinham a
     * observação escrita por extenso — passa todos para a versão abreviada, mesma
     * usada como sugestão ao escolher a justificativa no modal.
     */
    function migrarObservacoesAbreviadas() {
        if (window.__pontoObsAbreviadasMigradas) return;
        window.__pontoObsAbreviadasMigradas = true;
        if (!window.PontoStore) return;
        PontoStore.listarRegistros().forEach(function (r) {
            if (!r.tipoAtestado) return;
            var patch = null;

            var info = INFO_ATESTADO[r.tipoAtestado];
            if (info && info.abrev && r.observacoes !== info.abrev) {
                patch = Object.assign({}, r, { observacoes: info.abrev });
            }

            // Registros de abono/atestado salvos sem horário (campos em branco na Folha
            // de Ponto) ganham o horário padrão retroativamente, mesma regra aplicada a
            // partir de agora ao escolher a justificativa no modal.
            if (TIPOS_COM_HORARIO_PADRAO.indexOf(r.tipoAtestado) !== -1 &&
                (!r.entrada || !r.saidaAlmoco || !r.retornoAlmoco || !r.saida)) {
                var base = patch || Object.assign({}, r);
                preencherHorarioPadraoAtestado(base);
                patch = base;
            }

            if (patch) PontoStore.salvarRegistro(patch);
        });
    }

    function renderizar() {
        ligarListenersUmaVez();
        if (window.PontoStore) PontoStore.ensurePontoDefault();
        migrarObservacoesAbreviadas();

        var el = document.getElementById('pontoConteudo');
        if (!el) return;

        var abas = '<div class="ponto-subabas" role="tablist" aria-label="Seção de Ponto">' +
            SUBABAS.map(function (s) {
                return '<button type="button" class="ponto-subaba' + (s.chave === _subaba ? ' active' : '') + '" ' +
                    'role="tab" aria-selected="' + (s.chave === _subaba) + '" ' +
                    'data-ponto-action="trocarSubaba" data-valor="' + esc(s.chave) + '">' + esc(s.rotulo) + '</button>';
            }).join('') +
        '</div>';

        el.innerHTML = abas + '<div class="ponto-subaba-corpo">' + renderizarConteudoSubaba(_subaba) + '</div>';
        if (_subaba === 'registros') montarRegistrosLazy();
        ajustarPontoSticky();

        // Modais renderizados fora de #pontoConteudo, direto em <body>: um ancestral
        // com `transform` (ex: .tab-content, usado pra transição de aba) quebra
        // `position: fixed` — o elemento fixo passa a se posicionar relativo a esse
        // ancestral (que é altíssimo, por conter os N meses da Folha de Ponto) em vez
        // do viewport, fazendo o modal "abrir no meio da página" em vez de centralizado
        // na tela. Um filho direto de <body> não tem esse problema.
        var modalRoot = document.getElementById('pontoModalRoot');
        if (!modalRoot) {
            modalRoot = document.createElement('div');
            modalRoot.id = 'pontoModalRoot';
            document.body.appendChild(modalRoot);
        }
        modalRoot.innerHTML = renderizarModalFerias() + renderizarModalRegistro() + renderizarModalAcordo();

        if (_subaba === 'folha' && _folhaDeveRolar) {
            _folhaDeveRolar = false;
            var hoje = new Date();
            var mesAtual = el.querySelector('.timesheet-mes[data-year="' + hoje.getFullYear() + '"][data-month="' + hoje.getMonth() + '"]');
            if (mesAtual) {
                mesAtual.classList.add('timesheet-current');
                mesAtual.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    var ACOES = {
        trocarSubaba: function (el) {
            var valido = SUBABAS.some(function (s) { return s.chave === el.dataset.valor; });
            _subaba = valido ? el.dataset.valor : 'folha';
            if (_subaba === 'folha') _folhaDeveRolar = true;
            renderizar();
        },
        filtrarMesRegistros: function (el) { _mesRegistros = el.value; renderizar(); },

        // ── Filtros das listas ──
        regFiltroAcordo: function (el) { _fReg.acordo = el.value; renderizar(); },
        regFiltroDe: function (el) { _fReg.de = el.value; renderizar(); },
        regFiltroAte: function (el) { _fReg.ate = el.value; renderizar(); },
        regFiltroJusti: function (el) { _fReg.justificativa = el.value; renderizar(); },
        regFiltroSaldo: function (el) { _fReg.saldo = el.value; renderizar(); },
        regFiltroObs: function (el) { _fReg.obs = el.value; renderizar(); },
        regLimparFiltros: function () { _fReg = { acordo: '', de: '', ate: '', justificativa: '', saldo: '', obs: '' }; renderizar(); },

        evtFiltroAcordo: function (el) { _fEvt.acordo = el.value; renderizar(); },
        evtFiltroTipo: function (el) { _fEvt.tipo = el.value; renderizar(); },
        evtFiltroDe: function (el) { _fEvt.de = el.value; renderizar(); },
        evtFiltroAte: function (el) { _fEvt.ate = el.value; renderizar(); },
        evtLimparFiltros: function () { _fEvt = { acordo: '', tipo: '', de: '', ate: '' }; renderizar(); },

        acordoBuscar: function (el) { _buscaAcordos = el.value; renderizar(); },

        feriasRemover: function (el) {
            if (!podeEditar()) return;
            var id = el.dataset.valor;
            confirmarOuExecutar('Remover estas férias?', function () {
                PontoStore.removerPeriodoAquisitivo(id);
                if (window.Notifications) Notifications.success('Férias removidas.');
                renderizar();
            });
        },

        // ── Solicitar Férias (modal) ──
        feriasSolicitarAbrir: function (el) {
            if (!podeEditar()) return;
            var periodoIndex = Number(el.dataset.valor);
            var grupo = PontoStore.listarPeriodosAquisitivos().filter(function (p) { return p.periodoIndex === periodoIndex; });
            if (!grupo.length) { if (window.Notifications) Notifications.error('Período não encontrado.'); return; }

            var base = grupo[0];
            var comFerias = grupo.filter(function (p) { return p.feriasInicio && p.feriasFim; });
            if (comFerias.length >= MAX_FERIAS_SUBPERIODOS) {
                if (window.Notifications) Notifications.error('Limite de ' + MAX_FERIAS_SUBPERIODOS + ' períodos de férias atingido para este período aquisitivo.');
                return;
            }

            var MS_DIA = 86400000;
            var totalConcedidos = 0;
            grupo.forEach(function (sub) {
                if (sub.feriasInicio && sub.feriasFim) {
                    var dias = (sub.dias > 0) ? sub.dias : (Math.floor((new Date(sub.feriasFim) - new Date(sub.feriasInicio)) / MS_DIA) + 1);
                    if (dias > 0) totalConcedidos += dias;
                } else if (sub.dias > 0) {
                    totalConcedidos += sub.dias;
                }
            });
            var entitlement = FERIAS_DIAS_CLT;

            _feriasModal = {
                periodoIndex: periodoIndex,
                subIndex: comFerias.length + 1,
                faixa: (base.inicio && base.termino) ? (fmtData(base.inicio) + ' → ' + fmtData(base.termino)) : fmtData(base.inicio || base.termino),
                limite: base.limite,
                disponiveis: Math.max(0, entitlement - totalConcedidos),
                inicio: '', fim: '', adto13: ''
            };
            renderizar();
        },
        feriasSolicitarCancelar: function () { _feriasModal = null; renderizar(); },
        feriasDataMudou: function () {
            if (!_feriasModal) return;
            _feriasModal.inicio = valorCampo('pontoFeriasInicio');
            _feriasModal.fim = valorCampo('pontoFeriasFim');
            renderizar();
        },
        feriasSolicitarConfirmar: function () {
            if (!podeEditar() || !_feriasModal) return;
            var inicio = valorCampo('pontoFeriasInicio');
            var fim = valorCampo('pontoFeriasFim');
            var adto13 = valorCampo('pontoFeriasAdto13');

            if (!inicio || !fim) { if (window.Notifications) Notifications.error('Informe as datas de início e término.'); return; }
            var dtI = new Date(inicio), dtF = new Date(fim);
            if (isNaN(dtI.getTime()) || isNaN(dtF.getTime())) { if (window.Notifications) Notifications.error('Datas inválidas.'); return; }
            if (dtF < dtI) { if (window.Notifications) Notifications.error('A data de término deve ser maior ou igual à data de início.'); return; }

            var dias = Math.floor((dtF - dtI) / 86400000) + 1;
            if (dias > _feriasModal.disponiveis) {
                if (window.Notifications) Notifications.error('Quantidade de dias (' + dias + ') excede os dias disponíveis (' + _feriasModal.disponiveis + ').');
                return;
            }

            var grupo = PontoStore.listarPeriodosAquisitivos().filter(function (p) { return p.periodoIndex === _feriasModal.periodoIndex; });
            var alvo = grupo.filter(function (p) { return p.subIndex === _feriasModal.subIndex && !p.feriasInicio; })[0];
            if (alvo) {
                PontoStore.atualizarPeriodoAquisitivo(alvo.id, { feriasInicio: inicio, feriasFim: fim, dias: dias, adto13: adto13 });
            } else {
                var base = grupo[0];
                PontoStore.criarPeriodoAquisitivo({
                    periodoIndex: _feriasModal.periodoIndex, inicio: base.inicio, termino: base.termino, limite: base.limite,
                    subIndex: _feriasModal.subIndex, feriasInicio: inicio, feriasFim: fim, dias: dias, adto13: adto13
                });
            }

            var label = _feriasModal.subIndex + 'º Período';
            _feriasModal = null;
            if (window.Notifications) Notifications.success('Férias solicitadas: ' + label + ' (' + dias + ' dias).');
            renderizar();
        },

        // ── Folha de Ponto / timesheet ──
        timesheetTrocarAcordo: function (el) { _acordoTimesheet = Number(el.value); _folhaDeveRolar = true; renderizar(); },
        timesheetEditarDia: function (el) {
            if (!podeEditar()) return;
            var data = el.dataset.valor;
            var r = PontoStore.getRegistro(data);
            _registroForm = r ? Object.assign({}, r)
                : { data: data, entrada: '', saidaAlmoco: '', retornoAlmoco: '', saida: '', observacoes: '', tipoAtestado: '' };
            _registroForm._tipoAtestadoAnterior = _registroForm.tipoAtestado;
            renderizar();
        },

        // ── Registros (Fase 4, modal revisado) ──
        registroNovo: function () {
            if (!podeEditar()) return;
            _registroForm = { data: '', entrada: '', saidaAlmoco: '', retornoAlmoco: '', saida: '', observacoes: '', tipoAtestado: '' };
            _registroForm._tipoAtestadoAnterior = '';
            renderizar();
        },
        registroEditar: function (el) {
            if (!podeEditar()) return;
            var r = PontoStore.getRegistro(el.dataset.valor);
            if (!r) return;
            _registroForm = Object.assign({}, r);
            _registroForm._tipoAtestadoAnterior = _registroForm.tipoAtestado;
            renderizar();
        },
        registroCancelar: function () { _registroForm = null; renderizar(); },
        registroDataMudou: function () { sincronizarRegistroForm(); renderizar(); },
        registroTipoMudou: function () {
            sincronizarRegistroForm();
            // Sugere a observação abreviada da justificativa escolhida, sem sobrescrever
            // um texto que o usuário já tenha editado manualmente (só troca se o campo
            // estiver vazio ou ainda contiver a sugestão da justificativa anterior).
            var tipoAnterior = _registroForm._tipoAtestadoAnterior;
            var infoAnterior = tipoAnterior && INFO_ATESTADO[tipoAnterior];
            var sugestaoAnterior = infoAnterior && infoAnterior.abrev;
            var obsAtual = (_registroForm.observacoes || '').trim();
            if (!obsAtual || obsAtual === sugestaoAnterior) {
                var infoNovo = _registroForm.tipoAtestado && INFO_ATESTADO[_registroForm.tipoAtestado];
                _registroForm.observacoes = (infoNovo && infoNovo.abrev) || '';
            }
            _registroForm._tipoAtestadoAnterior = _registroForm.tipoAtestado;
            if (TIPOS_COM_HORARIO_PADRAO.indexOf(_registroForm.tipoAtestado) !== -1) {
                preencherHorarioPadraoAtestado(_registroForm);
            }
            renderizar();
        },
        registroSalvar: function () {
            if (!podeEditar()) return;
            var dados = {
                data: valorCampo('pontoRegData'),
                entrada: valorCampo('pontoRegEntrada') || null,
                saidaAlmoco: valorCampo('pontoRegSaidaAlmoco') || null,
                retornoAlmoco: valorCampo('pontoRegRetornoAlmoco') || null,
                saida: valorCampo('pontoRegSaida') || null,
                tipoAtestado: valorCampo('pontoRegAtestado') || null,
                observacoes: valorCampo('pontoRegObs')
            };
            // Cobre registros que já tinham a justificativa de atestado salva sem
            // horário (ex: dados antigos, ou o tipo foi escolhido sem disparar o
            // evento de troca) — completa na hora de salvar também.
            if (TIPOS_COM_HORARIO_PADRAO.indexOf(dados.tipoAtestado) !== -1) {
                preencherHorarioPadraoAtestado(dados);
            }
            var res = PontoStore.salvarRegistro(dados);
            if (res && res.erros && res.erros.length) {
                if (window.Notifications) Notifications.error(res.erros.join('; '));
                return;
            }
            _registroForm = null;
            if (dados.data) _mesRegistros = dados.data.slice(0, 7);
            if (window.Notifications) Notifications.success('Registro salvo.');
            renderizar();
        },
        registroExcluir: function (el) {
            if (!podeEditar()) return;
            var data = el.dataset.valor;
            var executar = function () {
                PontoStore.removerRegistro(data);
                if (window.Notifications) Notifications.success('Registro removido.');
                renderizar();
            };
            confirmarOuExecutar('Excluir o registro de ' + fmtData(data) + '?', executar);
        },

        // ── Eventos (Fase 4) ──
        eventoNovo: function () {
            if (!podeEditar()) return;
            var tipos = PontoStore.listarTiposEvento();
            _eventoForm = {
                id: null,
                tipoEvento: (tipos[0] && tipos[0].id) || 'outro',
                descricaoEvento: '', dataInicioEvento: '', dataFimEvento: '',
                periodo: 'dia_todo', impactoEvento: 'folga'
            };
            renderizar();
        },
        eventoEditar: function (el) {
            if (!podeEditar()) return;
            var ev = PontoStore.getEvento(el.dataset.valor);
            if (!ev) return;
            _eventoForm = Object.assign({}, ev);
            renderizar();
        },
        eventoCancelar: function () { _eventoForm = null; renderizar(); },
        eventoSalvar: function () {
            if (!podeEditar()) return;
            var acordoIdxRaw = valorCampo('pontoEvtAcordo');
            var dados = {
                tipoEvento: valorCampo('pontoEvtTipo'),
                descricaoEvento: valorCampo('pontoEvtDesc'),
                dataInicioEvento: valorCampo('pontoEvtInicio'),
                dataFimEvento: valorCampo('pontoEvtFim'),
                periodo: valorCampo('pontoEvtPeriodo'),
                impactoEvento: valorCampo('pontoEvtImpacto'),
                acordoIndex: acordoIdxRaw === '' ? null : Number(acordoIdxRaw)
            };
            var res = _eventoForm.id ? PontoStore.atualizarEvento(_eventoForm.id, dados) : PontoStore.criarEvento(dados);
            if (res && res.erros && res.erros.length) {
                if (window.Notifications) Notifications.error(res.erros.join('; '));
                return;
            }
            _eventoForm = null;
            if (window.Notifications) Notifications.success('Evento salvo.');
            renderizar();
        },
        eventoExcluir: function (el) {
            if (!podeEditar()) return;
            var id = el.dataset.valor;
            var executar = function () {
                PontoStore.removerEvento(id);
                if (window.Notifications) Notifications.success('Evento removido.');
                renderizar();
            };
            confirmarOuExecutar('Excluir este evento?', executar);
        },

        // ── Acordos — "Gerenciar Acordo" (Fase 4, revisão fiel ao modal original) ──
        acordoNovo: function () {
            if (!podeEditar()) return;
            _acordoForm = { id: null, nome: '', periodos: [], regrasHorario: [], qtdAbono: 0, qtdPagarHora: 0, _aba: 'resumo', _periodoEditando: null, _regraEditando: null };
            renderizar();
        },
        acordoEditar: function (el) {
            if (!podeEditar()) return;
            var a = PontoStore.getAcordo(el.dataset.valor);
            if (!a) return;
            _acordoForm = Object.assign(JSON.parse(JSON.stringify(a)), { _aba: 'resumo', _periodoEditando: null, _regraEditando: null });
            renderizar();
        },
        acordoCancelar: function () { _acordoForm = null; renderizar(); },
        acordoTrocarAba: function (el) {
            sincronizarAcordoDraft();
            var validas = ['resumo', 'periodos', 'regras', 'beneficios'];
            _acordoForm._aba = validas.indexOf(el.dataset.valor) !== -1 ? el.dataset.valor : 'resumo';
            renderizar();
        },
        acordoPeriodoEditar: function (el) {
            sincronizarAcordoDraft();
            _acordoForm._periodoEditando = Number(el.dataset.valor);
            renderizar();
        },
        acordoPeriodoRemover: function (el) {
            sincronizarAcordoDraft();
            _acordoForm.periodos.splice(Number(el.dataset.valor), 1);
            _acordoForm._periodoEditando = null;
            renderizar();
        },
        acordoPeriodoSalvar: function () {
            sincronizarAcordoDraft();
            var periodo = {
                inicio: valorCampo('pontoAcdNovoPerInicio'),
                fim: valorCampo('pontoAcdNovoPerFim'),
                minutosExtras: Number(valorCampo('pontoAcdNovoPerExtras')) || 0
            };
            var erros = PontoModel.validarPeriodoAcordo(periodo);
            if (erros.length) { if (window.Notifications) Notifications.error(erros.join('; ')); return; }
            if (_acordoForm._periodoEditando != null) {
                _acordoForm.periodos[_acordoForm._periodoEditando] = periodo;
                _acordoForm._periodoEditando = null;
            } else {
                _acordoForm.periodos.push(periodo);
            }
            renderizar();
        },
        acordoRegraEditar: function (el) {
            sincronizarAcordoDraft();
            _acordoForm._regraEditando = Number(el.dataset.valor);
            renderizar();
        },
        acordoRegraRemover: function (el) {
            sincronizarAcordoDraft();
            _acordoForm.regrasHorario.splice(Number(el.dataset.valor), 1);
            _acordoForm._regraEditando = null;
            renderizar();
        },
        acordoRegraSalvar: function () {
            sincronizarAcordoDraft();
            var regra = {
                inicio: valorCampo('pontoAcdNovoRegInicio'),
                fim: valorCampo('pontoAcdNovoRegFim'),
                inicioExpediente: valorCampo('pontoAcdNovoRegInicioExp') || null,
                minutosExtras: Number(valorCampo('pontoAcdNovoRegExtras')) || 0,
                almocoMin: Number(valorCampo('pontoAcdNovoRegAlmoco')) || 0,
                tolAlmoco: Number(valorCampo('pontoAcdNovoRegTolAlmoco')) || 0,
                tolSaida: Number(valorCampo('pontoAcdNovoRegTolSaida')) || 0,
                tipo: valorCampo('pontoAcdNovoRegTipo'),
                vale: Number(valorCampo('pontoAcdNovoRegVale')) || 0
            };
            var erros = PontoModel.validarRegraHorario(regra);
            if (erros.length) { if (window.Notifications) Notifications.error(erros.join('; ')); return; }
            if (_acordoForm._regraEditando != null) {
                _acordoForm.regrasHorario[_acordoForm._regraEditando] = regra;
                _acordoForm._regraEditando = null;
            } else {
                _acordoForm.regrasHorario.push(regra);
            }
            renderizar();
        },
        acordoSalvar: function () {
            if (!podeEditar()) return;
            sincronizarAcordoDraft();
            var dados = {
                nome: _acordoForm.nome,
                periodos: _acordoForm.periodos,
                regrasHorario: _acordoForm.regrasHorario,
                qtdAbono: _acordoForm.qtdAbono || 0,
                qtdPagarHora: _acordoForm.qtdPagarHora || 0
            };
            var res = _acordoForm.id ? PontoStore.atualizarAcordo(_acordoForm.id, dados) : PontoStore.criarAcordo(dados);
            if (res && res.erros && res.erros.length) {
                if (window.Notifications) Notifications.error(res.erros.join('; '));
                return;
            }
            _acordoForm = null;
            if (window.Notifications) Notifications.success('Acordo salvo.');
            renderizar();
        },
        acordoExcluir: function (el) {
            if (!podeEditar()) return;
            var id = el.dataset.valor;
            var executar = function () {
                PontoStore.removerAcordo(id);
                if (window.Notifications) Notifications.success('Acordo removido.');
                renderizar();
            };
            confirmarOuExecutar('Excluir este acordo?', executar);
        },
        acordoSecaoToggle: function (el) {
            var chave = el.dataset.acordo + ':' + el.dataset.secao;
            _acordoSecoesAbertas[chave] = !acordoSecaoAberta(el.dataset.acordo, el.dataset.secao, el.dataset.padrao === '1');
            renderizar();
        },
        acordoNovoEvento: function (el) {
            if (!podeEditar()) return;
            var acordos = PontoStore.listarAcordos();
            var idx = acordos.findIndex(function (a) { return a.id === el.dataset.valor; });
            var tipos = PontoStore.listarTiposEvento();
            _eventoForm = {
                id: null, tipoEvento: (tipos[0] && tipos[0].id) || 'outro', descricaoEvento: '',
                dataInicioEvento: '', dataFimEvento: '', periodo: 'dia_todo', impactoEvento: 'folga',
                acordoIndex: idx >= 0 ? idx : null
            };
            _subaba = 'eventos';
            renderizar();
        }
    };

    function podeEditar() {
        return typeof requireAdminOrNotify !== 'function' || requireAdminOrNotify();
    }

    function confirmarOuExecutar(mensagem, executar) {
        if (window.Notifications && Notifications.confirm) Notifications.confirm(mensagem, executar);
        else executar();
    }

    function aoClicarPonto(e) {
        var el = e.target.closest('[data-ponto-action]');
        if (!el) return;
        // SELECT/INPUT/TEXTAREA disparam suas ações via 'change' (aoMudarPonto);
        // tratar o 'click' aqui recriaria o elemento em pleno gesto de abrir
        // um <select>, fechando o dropdown nativo instantaneamente.
        var tag = el.tagName;
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        var fn = ACOES[el.dataset.pontoAction];
        if (fn) fn(el);
    }

    function aoMudarPonto(e) {
        var el = e.target.closest('[data-ponto-action]');
        if (!el) return;
        var fn = ACOES[el.dataset.pontoAction];
        if (fn) fn(el);
    }

    /**
     * Mede a altura real do título da aba e das sub-abas e expõe como variáveis
     * CSS (--ponto-header-h/--ponto-subabas-h) — mesmo esquema de
     * --flow-header-height em fluxo-nav.js. Isso deixa a barra de filtro/seletor
     * de cada sub-aba (.ponto-toolbar/.ponto-ts-toolbar) grudada logo abaixo,
     * sem precisar hardcodar alturas que variam com densidade/responsivo.
     */
    function ajustarPontoSticky() {
        var root = document.documentElement;
        var header = document.querySelector('#tab-ponto .section-header');
        var subabas = document.querySelector('.ponto-subabas');
        root.style.setProperty('--ponto-header-h', (header ? header.offsetHeight : 0) + 'px');
        root.style.setProperty('--ponto-subabas-h', (subabas ? subabas.offsetHeight : 0) + 'px');
    }

    function ligarListenersUmaVez() {
        if (window.__pontoListenersLigados) return;
        window.__pontoListenersLigados = true;
        document.addEventListener('click', aoClicarPonto);
        document.addEventListener('change', aoMudarPonto);
        window.addEventListener('resize', ajustarPontoSticky);
    }

    window.PontoUI = {
        renderizar: renderizar,
        _justificativas: INFO_ATESTADO
    };
})();
