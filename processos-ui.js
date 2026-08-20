/**
 * processos-ui.js - Renderização e interação da aba de Processos (SEI)
 *
 * Mesmo padrão delegado de ponto-ui.js/crm-ui.js: dono do próprio atributo de
 * ação (`data-processos-action`) e mapa de ações, sem listeners inline.
 * Entrada e organização manual dos processos já levantados do SEI — sem
 * integração automática com o sistema do SEI nesta fase.
 */
(function () {
    var esc = function (v) { return (window.Utils && Utils.escapeHtml) ? Utils.escapeHtml(v) : String(v == null ? '' : v); };

    var ORIGEM_LABEL = { marcado: 'Marcado', sem_marcador: 'Sem marcador', nao_triado: 'Não triado' };
    var ORIGEM_ORDEM = ['todos', 'marcado', 'sem_marcador', 'nao_triado'];
    var ORIGEM_ROTULO_CHIP = { todos: 'Todos', marcado: 'Marcados', sem_marcador: 'Sem marcador', nao_triado: 'Não triados' };

    var _filtroOrigem = 'todos';
    var _busca = '';
    var _processoForm = null; // draft de edição (assunto/tipo/marcadores/grupos/observação) | null
    var _helpAberto = false;

    function podeEditar() {
        return typeof requireAdminOrNotify !== 'function' || requireAdminOrNotify();
    }

    function confirmarOuExecutar(mensagem, executar) {
        if (window.Notifications && Notifications.confirm) Notifications.confirm(mensagem, executar);
        else executar();
    }

    function valorCampo(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    // ── Agregações do painel-resumo ──
    function contarPorOrigem(lista) {
        var c = { todos: lista.length, marcado: 0, sem_marcador: 0, nao_triado: 0 };
        lista.forEach(function (p) { if (c[p.origem] != null) c[p.origem]++; });
        return c;
    }

    function contarPorMarcador(lista) {
        var mapa = {};
        lista.forEach(function (p) { p.marcadores.forEach(function (m) { mapa[m] = (mapa[m] || 0) + 1; }); });
        return Object.keys(mapa).map(function (m) { return { marcador: m, total: mapa[m] }; })
            .sort(function (a, b) { return b.total - a.total || a.marcador.localeCompare(b.marcador); });
    }

    // ── Filtro / busca ──
    function processoBate(p, buscaLower) {
        if (!buscaLower) return true;
        if ((p.numero || '').toLowerCase().indexOf(buscaLower) !== -1) return true;
        if ((p.assunto || '').toLowerCase().indexOf(buscaLower) !== -1) return true;
        if (p.marcadores.some(function (m) { return m.toLowerCase().indexOf(buscaLower) !== -1; })) return true;
        if (p.acompanhamentoEspecial.some(function (g) { return g.toLowerCase().indexOf(buscaLower) !== -1; })) return true;
        return false;
    }

    function listaFiltrada(todos) {
        var buscaLower = _busca.trim().toLowerCase();
        return todos.filter(function (p) {
            if (_filtroOrigem !== 'todos' && p.origem !== _filtroOrigem) return false;
            return processoBate(p, buscaLower);
        }).sort(function (a, b) { return (a.numero || '').localeCompare(b.numero || ''); });
    }

    // ── Header com botão de help ──
    function renderizarHeader() {
        return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e5e7eb">' +
            '<h2 style="margin:0;font-size:1.25rem;font-weight:600;color:#1f2937">📋 Processos (SEI)</h2>' +
            '<button type="button" data-processos-action="abrirHelp" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:1.2rem;display:flex;align-items:center;justify-content:center;padding:0;transition:background 0.2s" title="Como usar a extensão Claude para verificar novos processos">' +
            '?' +
            '</button>' +
            '</div>';
    }

    function renderizarHelpModal() {
        if (!_helpAberto) return '';
        return '<div class="procs-modal-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000" data-processos-action="fecharHelpOverlay">' +
            '<div class="procs-help-modal" style="background:white;border-radius:8px;max-width:500px;width:90%;padding:24px;box-shadow:0 20px 25px rgba(0,0,0,0.15);max-height:80vh;overflow-y:auto">' +
            '<h3 style="margin:0 0 16px 0;font-size:1.125rem;font-weight:600;color:#1f2937">🚀 Como Verificar Novos Processos</h3>' +
            '<ol style="margin:0 0 20px 0;padding-left:20px;color:#374151;line-height:1.6">' +
            '<li style="margin-bottom:12px"><strong>Abra a aba do SEI</strong> no Chrome (já logada na unidade DVMNA-FI)</li>' +
            '<li style="margin-bottom:12px"><strong>Clique no ícone do Claude</strong> (extensão, canto superior direito)</li>' +
            '<li style="margin-bottom:12px"><strong>Cole esta mensagem</strong> na janela que abrir:</li>' +
            '</ol>' +
            '<div style="background:#f0f9ff;border:1px solid #0284c7;border-radius:6px;padding:12px;margin-bottom:20px">' +
            '<code style="font-family:monospace;font-size:0.875rem;color:#0c4a6e;word-break:break-word">Verifica novos processos</code>' +
            '<button type="button" data-processos-action="copiarMensagem" style="display:block;margin-top:8px;background:#0284c7;color:white;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-size:0.875rem;transition:background 0.2s" onmouseover="this.style.background=\'#0369a1\'" onmouseout="this.style.background=\'#0284c7\'">Copiar mensagem</button>' +
            '</div>' +
            '<p style="margin:0 0 16px 0;color:#4b5563;font-size:0.875rem"><strong>O que vai acontecer:</strong> Vou ler a página do SEI, comparar com o que já temos no Nexus (por número do processo) e listar os novos encontrados.</p>' +
            '<div style="display:flex;gap:8px">' +
            '<button type="button" data-processos-action="fecharHelp" style="flex:1;background:#e5e7eb;border:1px solid #d1d5db;border-radius:6px;padding:8px 12px;cursor:pointer;font-weight:500;color:#1f2937;transition:background 0.2s" onmouseover="this.style.background=\'#d1d5db\'" onmouseout="this.style.background=\'#e5e7eb\'">Fechar</button>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    // ── Painel-resumo ──
    function renderizarResumo(todos, porOrigem) {
        var porMarcador = contarPorMarcador(todos);
        var stats = '<div class="procs-resumo-stats">' +
            '<div class="procs-stat"><span>Total</span><strong>' + porOrigem.todos + '</strong></div>' +
            '<div class="procs-stat procs-stat-marcado"><span>Marcados</span><strong>' + porOrigem.marcado + '</strong></div>' +
            '<div class="procs-stat procs-stat-aviso"><span>Sem marcador</span><strong>' + porOrigem.sem_marcador + '</strong></div>' +
            '<div class="procs-stat procs-stat-aviso"><span>Não triados</span><strong>' + porOrigem.nao_triado + '</strong></div>' +
        '</div>';
        var listaMarcadores = porMarcador.length
            ? '<div class="procs-resumo-marcadores">' + porMarcador.map(function (m) {
                return '<span class="procs-tag-resumo">' + esc(m.marcador) + ' <b>' + m.total + '</b></span>';
            }).join('') + '</div>'
            : '';
        return '<div class="procs-resumo">' + stats + listaMarcadores + '</div>';
    }

    // ── Toolbar (chips de origem + busca) ──
    function renderizarChips(porOrigem) {
        return '<div class="procs-chips">' + ORIGEM_ORDEM.map(function (chave) {
            return '<button type="button" class="procs-chip' + (chave === _filtroOrigem ? ' active' : '') + '" ' +
                'data-processos-action="filtroOrigem" data-valor="' + chave + '">' +
                esc(ORIGEM_ROTULO_CHIP[chave]) + ' <span>' + porOrigem[chave] + '</span></button>';
        }).join('') + '</div>';
    }

    function renderizarToolbar(porOrigem) {
        return '<div class="ponto-toolbar procs-toolbar">' +
            renderizarChips(porOrigem) +
            '<div class="ponto-filtro-grupo ponto-filtro-cresce"><label>Buscar</label>' +
                '<input type="text" data-processos-action="buscarMudou" value="' + esc(_busca) + '" placeholder="Número, assunto, marcador ou grupo..."></div>' +
        '</div>';
    }

    // ── Tabela ──
    function badgeOrigem(p) {
        return '<span class="procs-badge procs-badge-' + p.origem + '">' + esc(ORIGEM_LABEL[p.origem]) + '</span>';
    }

    function renderizarTagsLeitura(lista, classeExtra) {
        return lista.map(function (v) {
            return '<span class="procs-tag' + (classeExtra ? ' ' + classeExtra : '') + '">' + esc(v) + '</span>';
        }).join('') || '<span class="procs-vazio">—</span>';
    }

    function renderizarTabela(lista) {
        if (!lista.length) {
            var semResultado = (_busca.trim() || _filtroOrigem !== 'todos');
            return '<div class="ponto-placeholder"><p>Nenhum processo encontrado' + (semResultado ? ' para este filtro.' : '.') + '</p></div>';
        }
        var linhas = lista.map(function (p) {
            var alerta = (p.origem === 'sem_marcador' || p.origem === 'nao_triado');
            return '<tr class="' + (alerta ? 'procs-row-alerta' : '') + '">' +
                '<td class="procs-col-numero">' + esc(p.numero) + '</td>' +
                '<td>' + esc(p.assunto || '—') + '</td>' +
                '<td class="procs-col-tipo">' + esc(p.tipoProcesso || '—') + '</td>' +
                '<td>' + renderizarTagsLeitura(p.marcadores) + '</td>' +
                '<td>' + renderizarTagsLeitura(p.acompanhamentoEspecial, 'procs-tag-grupo') + '</td>' +
                '<td>' + badgeOrigem(p) + '</td>' +
                '<td class="procs-col-sugestao">' + (p.sugestaoMarcador ? esc(p.sugestaoMarcador) : '—') + '</td>' +
                '<td class="procs-col-obs">' + esc(p.observacao || '—') + '</td>' +
                '<td class="ponto-col-acoes">' +
                    '<button type="button" class="crm-btn-mini" data-processos-action="editar" data-valor="' + esc(p.id) + '">Editar</button>' +
                    '<button type="button" class="crm-btn-mini crm-btn-mini-perigo" data-processos-action="excluir" data-valor="' + esc(p.id) + '">Excluir</button>' +
                '</td>' +
            '</tr>';
        }).join('');
        return '<div class="crm-lista-wrapper procs-lista-wrapper"><table class="crm-lista-table procs-tabela"><thead><tr>' +
            '<th>Número</th><th>Assunto</th><th>Tipo</th><th>Marcadores</th><th>Acompanhamento Especial</th>' +
            '<th>Origem</th><th>Sugestão</th><th>Observação</th><th>Ações</th>' +
        '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
    }

    // ── Modal de edição / classificação ──
    function sincronizarModalDraft() {
        if (!_processoForm) return;
        _processoForm.assunto = valorCampo('procsAssunto');
        _processoForm.tipoProcesso = valorCampo('procsTipoProcesso');
        _processoForm.observacao = valorCampo('procsObservacao');
    }

    function opcoesMarcadoresDisponiveis(draft) {
        var conhecidos = (window.ProcessosStore ? ProcessosStore.listarMarcadoresConhecidos() : []);
        var disponiveis = conhecidos.filter(function (m) { return draft.marcadores.indexOf(m) === -1; });
        return '<option value="">+ Aplicar marcador existente…</option>' +
            disponiveis.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('');
    }

    function renderizarTagsEditaveis(lista, acao, classeExtra) {
        return lista.map(function (v) {
            return '<span class="procs-tag procs-tag-editavel' + (classeExtra ? ' ' + classeExtra : '') + '">' + esc(v) +
                '<button type="button" data-processos-action="' + acao + '" data-valor="' + esc(v) + '">×</button></span>';
        }).join('') || '<span class="procs-vazio">Nenhum</span>';
    }

    function renderizarModal() {
        if (!_processoForm) return '';
        var d = _processoForm;
        return '<div class="ponto-modal-backdrop">' +
            '<div class="ponto-modal procs-modal">' +
                '<div class="ponto-modal-header"><h4>Processo ' + esc(d.numero) + '</h4>' +
                    '<button type="button" class="ponto-modal-fechar" data-processos-action="modalCancelar">×</button></div>' +
                '<div class="ponto-modal-corpo">' +
                    '<div class="ponto-modal-campo"><label>Assunto</label>' +
                        '<input type="text" id="procsAssunto" value="' + esc(d.assunto) + '" placeholder="Do que se trata o processo..."></div>' +
                    '<div class="ponto-modal-campo"><label>Tipo de Processo (SEI)</label>' +
                        '<input type="text" id="procsTipoProcesso" value="' + esc(d.tipoProcesso) + '"></div>' +
                    '<div class="ponto-modal-campo"><label>Marcadores</label>' +
                        '<div class="procs-tags-lista">' + renderizarTagsEditaveis(d.marcadores, 'marcadorRemover') + '</div>' +
                        '<div class="procs-add-linha">' +
                            '<select data-processos-action="marcadorSelecionar">' + opcoesMarcadoresDisponiveis(d) + '</select>' +
                            '<input type="text" id="procsNovoMarcador" placeholder="Ou criar marcador novo...">' +
                            '<button type="button" class="btn-secondary crm-btn-mini" data-processos-action="marcadorAdicionarNovo">+ Adicionar</button>' +
                        '</div></div>' +
                    '<div class="ponto-modal-campo"><label>Acompanhamento Especial</label>' +
                        '<div class="procs-tags-lista">' + renderizarTagsEditaveis(d.acompanhamentoEspecial, 'grupoRemover', 'procs-tag-grupo') + '</div>' +
                        '<div class="procs-add-linha">' +
                            '<input type="text" id="procsNovoGrupo" placeholder="Nome do grupo...">' +
                            '<button type="button" class="btn-secondary crm-btn-mini" data-processos-action="grupoAdicionar">+ Adicionar</button>' +
                        '</div></div>' +
                    (d.sugestaoMarcador ? '<div class="ponto-modal-campo"><label>Sugestão (SEI)</label><span class="procs-sugestao-texto">' + esc(d.sugestaoMarcador) + '</span></div>' : '') +
                    '<div class="ponto-modal-campo"><label>Observação</label>' +
                        '<textarea id="procsObservacao" rows="3" placeholder="Anotações, alertas de prazo...">' + esc(d.observacao) + '</textarea></div>' +
                '</div>' +
                '<div class="ponto-modal-rodape">' +
                    '<button type="button" class="btn-secondary crm-btn-mini" data-processos-action="modalCancelar">Cancelar</button>' +
                    '<button type="button" class="btn-primary crm-btn-mini" data-processos-action="modalSalvar">Salvar</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    // ── Ações (data-processos-action) ──
    var ACOES = {
        filtroOrigem: function (el) { _filtroOrigem = el.dataset.valor || 'todos'; renderizar(); },
        buscarMudou: function (el) { _busca = el.value; renderizar(); },

        editar: function (el) {
            if (!podeEditar()) return;
            var p = window.ProcessosStore && ProcessosStore.getProcesso(el.dataset.valor);
            if (!p) return;
            _processoForm = {
                id: p.id, numero: p.numero, assunto: p.assunto || '', tipoProcesso: p.tipoProcesso || '',
                observacao: p.observacao || '', sugestaoMarcador: p.sugestaoMarcador,
                marcadores: p.marcadores.slice(), acompanhamentoEspecial: p.acompanhamentoEspecial.slice()
            };
            renderizar();
        },

        excluir: function (el) {
            if (!podeEditar()) return;
            var id = el.dataset.valor;
            confirmarOuExecutar('Remover este processo da lista? (isto não afeta o processo no SEI)', function () {
                var removido = ProcessosStore.removerProcesso(id);
                if (!removido) {
                    if (window.Notifications) Notifications.error('Processo não encontrado — a lista pode ter sido atualizada em outra sessão.');
                    renderizar();
                    return;
                }
                if (window.Notifications) Notifications.success('Processo removido.');
                renderizar();
            });
        },

        modalCancelar: function () { _processoForm = null; renderizar(); },

        abrirHelp: function () { _helpAberto = true; renderizar(); },
        fecharHelp: function () { _helpAberto = false; renderizar(); },
        fecharHelpOverlay: function (el) { if (el.className.indexOf('procs-modal-overlay') !== -1) { _helpAberto = false; renderizar(); } },

        copiarMensagem: function () {
            var msg = 'Verifica novos processos';
            if (window.navigator && window.navigator.clipboard) {
                window.navigator.clipboard.writeText(msg).then(function () {
                    if (window.Notifications) Notifications.success('Mensagem copiada para a área de transferência! Cole na extensão do Claude.');
                });
            } else {
                var textarea = document.createElement('textarea');
                textarea.value = msg;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                if (window.Notifications) Notifications.success('Mensagem copiada!');
            }
        },

        modalSalvar: function () {
            if (!podeEditar()) return;
            sincronizarModalDraft();
            var d = _processoForm;
            var patch = {
                assunto: d.assunto,
                tipoProcesso: d.tipoProcesso,
                observacao: d.observacao,
                marcadores: d.marcadores,
                acompanhamentoEspecial: d.acompanhamentoEspecial,
                origem: ProcessosModel.origemParaClassificacao(d.marcadores, d.acompanhamentoEspecial),
                sugestaoMarcador: d.marcadores.length ? null : d.sugestaoMarcador
            };
            var res = ProcessosStore.atualizarProcesso(d.id, patch);
            if (!res) {
                if (window.Notifications) Notifications.error('Processo não encontrado — a lista pode ter sido atualizada em outra sessão.');
                _processoForm = null;
                renderizar();
                return;
            }
            if (res.erros.length) {
                if (window.Notifications) Notifications.error(res.erros.join('; '));
                return;
            }
            _processoForm = null;
            if (window.Notifications) Notifications.success('Processo atualizado.');
            renderizar();
        },

        marcadorSelecionar: function (el) {
            if (!el.value) return;
            sincronizarModalDraft();
            if (_processoForm.marcadores.indexOf(el.value) === -1) _processoForm.marcadores.push(el.value);
            renderizar();
        },
        marcadorAdicionarNovo: function () {
            sincronizarModalDraft();
            var novo = valorCampo('procsNovoMarcador').trim();
            if (!novo) return;
            if (_processoForm.marcadores.indexOf(novo) === -1) _processoForm.marcadores.push(novo);
            renderizar();
        },
        marcadorRemover: function (el) {
            sincronizarModalDraft();
            _processoForm.marcadores = _processoForm.marcadores.filter(function (m) { return m !== el.dataset.valor; });
            renderizar();
        },

        grupoAdicionar: function () {
            sincronizarModalDraft();
            var novo = valorCampo('procsNovoGrupo').trim();
            if (!novo) return;
            if (_processoForm.acompanhamentoEspecial.indexOf(novo) === -1) _processoForm.acompanhamentoEspecial.push(novo);
            renderizar();
        },
        grupoRemover: function (el) {
            sincronizarModalDraft();
            _processoForm.acompanhamentoEspecial = _processoForm.acompanhamentoEspecial.filter(function (g) { return g !== el.dataset.valor; });
            renderizar();
        }
    };

    function aoClicarProcessos(e) {
        var el = e.target.closest('[data-processos-action]');
        if (!el) return;
        // SELECT/INPUT/TEXTAREA disparam via 'change' (aoMudarProcessos) — tratar
        // no 'click' fecharia um <select> aberto em pleno gesto (mesmo cuidado do Ponto).
        var tag = el.tagName;
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        var fn = ACOES[el.dataset.processosAction];
        if (fn) fn(el);
    }

    function aoMudarProcessos(e) {
        var el = e.target.closest('[data-processos-action]');
        if (!el) return;
        var fn = ACOES[el.dataset.processosAction];
        if (fn) fn(el);
    }

    function ligarListenersUmaVez() {
        if (window.__processosListenersLigados) return;
        window.__processosListenersLigados = true;
        document.addEventListener('click', aoClicarProcessos);
        document.addEventListener('change', aoMudarProcessos);
    }

    function renderizar() {
        ligarListenersUmaVez();
        if (window.ProcessosStore) ProcessosStore.ensureProcessosDefault();

        var el = document.getElementById('processosConteudo');
        if (!el) return;

        var todos = (window.ProcessosStore ? ProcessosStore.listarProcessos() : []);
        var porOrigem = contarPorOrigem(todos);
        var lista = listaFiltrada(todos);

        el.innerHTML = renderizarHeader() + renderizarResumo(todos, porOrigem) + renderizarToolbar(porOrigem) + renderizarTabela(lista) + renderizarModal() + renderizarHelpModal();
    }

    window.ProcessosUI = {
        renderizar: renderizar
    };
})();
