/* ════════════════════════════════════════════════════════════════
   NAVEGAÇÃO EM FLUXO DE TRABALHO — controlador
   Constrói a barra global (workspace switch), a esteira de 5 etapas
   (Operação) e a faixa de referência. Dirige o trocarAba() existente,
   sem tocar na lógica de renderização do app.

   Pipeline:  ① Estoque → ② Precificação → ③ Proposta → ④ Venda → ⑤ Envio
   Workspaces: Operação (fluxo) | IMBEL (separado)
   ════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var LS_STEP = 'fluxoNav.step';
    var LS_WS = 'fluxoNav.workspace';

    // ── Ícones (inline SVG, stroke currentColor) ──
    var I = {
        box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
        tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
        doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
        truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
        grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
        chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>'
    };

    // ── Etapas do pipeline (Operação) ──
    var STEPS = [
        { tab: 'estoque', t: 'Estoque', s: 'o que temos', icon: I.box },
        { tab: 'precificacao', t: 'Precificação', s: 'quanto cobrar', icon: I.tag },
        { tab: 'propostas', t: 'Proposta', s: 'montar oferta', icon: I.doc },
        { tab: 'vendas', t: 'Venda', s: 'fechar contrato', icon: I.cart },
        { tab: 'envio', t: 'Envio', s: 'doc. e entrega', icon: I.truck }
    ];

    // ── Telas de referência (fora do fluxo) ──
    // sub: quando informado, reaproveita a Precificação e troca a sub-aba.
    var REFS = [
        { label: 'Painel', tab: 'dashboard', icon: I.grid },
        { label: 'Clientes', tab: 'clientes', icon: I.users },
        { sep: true },
        { label: 'Impostos', tab: 'precificacao', sub: 'impostos', icon: I.receipt },
        { label: 'Rastreabilidade', tab: 'precificacao', sub: 'rastreabilidade', icon: I.link },
        { label: 'CI', tab: 'precificacao', sub: 'tabelaci', icon: I.dollar },
        { sep: true },
        { label: 'Produtos', tab: 'cadastro-produtos', icon: I.file },
        { label: 'Distribuição', tab: 'distribuicao', icon: I.truck },
        { label: 'Relatórios', tab: 'relatorios', icon: I.chart },
        { label: 'Configurações', tab: 'configuracoes', icon: I.gear }
    ];

    var currentStep = 0;      // índice em STEPS
    var workspace = 'operacao';
    var els = {};             // refs de DOM
    var stepBtns = [];
    var refBtns = [];         // { el, ref }

    // ══════════════════════════════════════════════════════════
    //  Construção do DOM
    // ══════════════════════════════════════════════════════════
    function build() {
        var container = document.querySelector('.container');
        if (!container) return;

        // Marca (reaproveita o SVG do logo existente, se houver)
        var logoInner = '';
        var logoSvg = document.querySelector('.sidebar .logo-svg');
        if (logoSvg) logoInner = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' + logoSvg.innerHTML + '</svg>';

        var header = document.createElement('div');
        header.className = 'flow-header';
        header.innerHTML =
            '<div class="flow-globalbar">' +
                '<div class="flow-brand">' +
                    '<span class="flow-brand-mark">' + logoInner + '</span>' +
                    '<span>Nexus</span>' +
                    '<span class="flow-brand-sub">Operações Conectadas</span>' +
                '</div>' +
                '<div class="ws-switch" role="tablist" aria-label="Workspace">' +
                    '<button class="ws-btn operacao active" data-ws="operacao" type="button">' + I.box + '<span>Operação</span></button>' +
                    '<button class="ws-btn relacionamento" data-ws="relacionamento" type="button">' + I.heart + '<span>Relacionamento</span></button>' +
                    '<button class="ws-btn imbel" data-ws="imbel" type="button">' + I.shield + '<span>IMBEL</span></button>' +
                    '<button class="ws-btn ponto" data-ws="ponto" type="button" style="border-left: 1px solid var(--sidebar-border)">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + '<span>Ponto</span></button>' +
                    '<button class="ws-btn processos" data-ws="processos" type="button">' + I.file + '<span>Processos</span></button>' +
                '</div>' +
                '<div class="flow-status"></div>' +
            '</div>' +
            '<div class="pipebar" role="tablist" aria-label="Etapas do fluxo"></div>' +
            '<div class="refbar" aria-label="Telas de referência">' +
                '<span class="refbar-lbl">Referência</span>' +
            '</div>';

        container.insertBefore(header, container.firstChild);

        els.header = header;
        els.globalbar = header.querySelector('.flow-globalbar');
        els.pipebar = header.querySelector('.pipebar');
        els.refbar = header.querySelector('.refbar');
        els.status = header.querySelector('.flow-status');
        els.wsBtns = header.querySelectorAll('.ws-btn[data-ws]');

        buildPipebar();
        buildRefbar();
        relocateStatusActions();
        ensureEnvioTab();
    }

    function buildPipebar() {
        STEPS.forEach(function (st, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pstep';
            btn.setAttribute('data-step', i);
            btn.innerHTML =
                '<span class="pn">' + (i + 1) + '</span>' +
                '<span class="picon">' + st.icon + '</span>' +
                '<span class="pl"><span class="t">' + st.t + '</span><span class="s">' + st.s + '</span></span>';
            btn.addEventListener('click', function () { goStep(i); });
            els.pipebar.appendChild(btn);
            stepBtns.push(btn);

            if (i < STEPS.length - 1) {
                var arrow = document.createElement('span');
                arrow.className = 'parrow';
                arrow.innerHTML = I.chevron;
                els.pipebar.appendChild(arrow);
            }
        });

        // Botão "Próximo passo"
        var next = document.createElement('button');
        next.type = 'button';
        next.className = 'pnext';
        next.innerHTML = '<span class="pnext-lbl">Próximo</span>' + I.chevron;
        next.addEventListener('click', function () { if (currentStep < STEPS.length - 1) goStep(currentStep + 1); });
        els.pipebar.appendChild(next);
        els.next = next;
    }

    function buildRefbar() {
        REFS.forEach(function (r) {
            if (r.sep) {
                var sep = document.createElement('span');
                sep.className = 'refbar-sep';
                els.refbar.appendChild(sep);
                return;
            }
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ref-btn';
            btn.innerHTML = (r.icon || '') + '<span>' + r.label + '</span>';
            btn.addEventListener('click', function () { goRef(r); });
            els.refbar.appendChild(btn);
            refBtns.push({ el: btn, ref: r });
        });
    }

    // Realoca status do Firestore + auth + ações de cloud para a barra global,
    // preservando IDs/handlers existentes (apenas move os nós).
    function relocateStatusActions() {
        var fsStatus = document.getElementById('firestoreStatus');
        var authPanel = document.getElementById('authPanel');
        var actions = document.querySelector('.sidebar-footer .sidebar-footer-actions');

        // Menu de ações (dropdown) recebe os botões admin de cloud/backup + auth
        var menu = document.createElement('div');
        menu.className = 'flow-actions-menu';
        menu.innerHTML =
            '<button class="flow-actions-toggle" type="button">' + I.gear + '<span>Ações</span></button>' +
            '<div class="flow-actions-drop"></div>';
        var toggle = menu.querySelector('.flow-actions-toggle');
        var drop = menu.querySelector('.flow-actions-drop');

        if (actions) {
            // Move todos os botões de ação (cloud/backup/verificar) e o painel de auth
            Array.prototype.slice.call(actions.children).forEach(function (child) {
                drop.appendChild(child);
            });
        } else if (authPanel) {
            drop.appendChild(authPanel);
        }

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.classList.toggle('open');
        });
        document.addEventListener('click', function () { menu.classList.remove('open'); });
        drop.addEventListener('click', function (e) { e.stopPropagation(); });

        if (fsStatus) els.status.appendChild(fsStatus);
        els.status.appendChild(menu);
    }

    // Cria a tela placeholder de Envio (etapa 5) se ainda não existir
    function ensureEnvioTab() {
        if (document.getElementById('tab-envio')) return;
        var container = document.querySelector('.container');
        var div = document.createElement('div');
        div.className = 'tab-content';
        div.id = 'tab-envio';
        div.innerHTML =
            '<div class="content-area">' +
                '<div class="flow-placeholder">' +
                    '<div class="fp-icon">🚚</div>' +
                    '<h2>Envio — documentação e expedição</h2>' +
                    '<p>Etapa final do fluxo: geração de documentação, assinatura e expedição do contrato fechado. Esta tela ainda está em construção.</p>' +
                    '<span class="fp-badge">Em desenvolvimento</span>' +
                '</div>' +
            '</div>';
        container.appendChild(div);
    }

    // ══════════════════════════════════════════════════════════
    //  Navegação
    // ══════════════════════════════════════════════════════════
    function clearRefActive() {
        refBtns.forEach(function (rb) { rb.el.classList.remove('active'); });
        document.body.classList.remove('flow-ref-precif');
    }

    function paintSteps() {
        stepBtns.forEach(function (btn, i) {
            btn.classList.remove('active', 'done');
            var pn = btn.querySelector('.pn');
            if (i < currentStep) {
                btn.classList.add('done');
                if (pn) pn.innerHTML = I.check;
            } else {
                if (pn) pn.textContent = (i + 1);
                if (i === currentStep) btn.classList.add('active');
            }
        });
        if (els.next) {
            var last = currentStep >= STEPS.length - 1;
            els.next.disabled = last;
            var lbl = els.next.querySelector('.pnext-lbl');
            if (lbl) lbl.textContent = last ? 'Concluído' : ('Próximo: ' + STEPS[currentStep + 1].t);
        }
    }

    function goStep(i) {
        if (i < 0 || i >= STEPS.length) return;
        currentStep = i;
        clearRefActive();
        paintSteps();
        try { if (typeof window.trocarAba === 'function') window.trocarAba(STEPS[i].tab); } catch (e) {}
        try { localStorage.setItem(LS_STEP, String(i)); } catch (e) {}
    }

    function goRef(r) {
        clearRefActive();
        // Marca o botão clicado
        refBtns.forEach(function (rb) { if (rb.ref === r) rb.el.classList.add('active'); });

        try {
            if (typeof window.trocarAba === 'function') window.trocarAba(r.tab);
            if (r.sub) {
                // Reaproveita a tela Precificação como container, sem a barra de sub-abas
                document.body.classList.add('flow-ref-precif');
                if (typeof window.trocarSubabaPrecif === 'function') window.trocarSubabaPrecif(r.sub);
            }
        } catch (e) {}
    }

    // ══════════════════════════════════════════════════════════
    //  Workspaces
    // ══════════════════════════════════════════════════════════
    function setWorkspace(ws) {
        workspace = ws;
        els.wsBtns.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-ws') === ws); });
        var imbel = (ws === 'imbel');
        var relacionamento = (ws === 'relacionamento');
        var ponto = (ws === 'ponto');
        var processos = (ws === 'processos');
        els.pipebar.style.display = (imbel || relacionamento || ponto || processos) ? 'none' : '';
        els.refbar.style.display = (imbel || relacionamento || ponto || processos) ? 'none' : '';
        try { localStorage.setItem(LS_WS, ws); } catch (e) {}

        if (imbel) {
            clearRefActive();
            stepBtns.forEach(function (b) { b.classList.remove('active'); });
            try { if (typeof window.trocarAba === 'function') window.trocarAba('controleimbel'); } catch (e) {}
        } else if (relacionamento) {
            clearRefActive();
            stepBtns.forEach(function (b) { b.classList.remove('active'); });
            try { if (typeof window.trocarAba === 'function') window.trocarAba('relacionamento'); } catch (e) {}
        } else if (ponto) {
            clearRefActive();
            stepBtns.forEach(function (b) { b.classList.remove('active'); });
            try { if (typeof window.trocarAba === 'function') window.trocarAba('ponto'); } catch (e) {}
        } else if (processos) {
            clearRefActive();
            stepBtns.forEach(function (b) { b.classList.remove('active'); });
            try { if (typeof window.trocarAba === 'function') window.trocarAba('processos'); } catch (e) {}
        } else {
            goStep(currentStep);
        }
        adjustHeaderHeight();
    }

    // Ajusta o padding-top do body à altura real do cabeçalho (varia com workspace/responsivo)
    function adjustHeaderHeight() {
        if (!els.header) return;
        var h = els.header.offsetHeight;
        document.body.style.setProperty('padding-top', h + 'px');
        // Exposta como variável CSS para telas com sua própria barra fixa (ex: sub-abas do
        // Ponto) grudarem logo abaixo do cabeçalho fixo, sem precisar hardcodar a altura.
        document.documentElement.style.setProperty('--flow-header-height', h + 'px');
    }

    // ══════════════════════════════════════════════════════════
    //  Teclado: Alt+← / Alt+→ move entre etapas
    // ══════════════════════════════════════════════════════════
    function onKey(e) {
        if (!e.altKey || workspace !== 'operacao') return;
        if (e.key === 'ArrowRight') { e.preventDefault(); if (currentStep < STEPS.length - 1) goStep(currentStep + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); if (currentStep > 0) goStep(currentStep - 1); }
    }

    // ══════════════════════════════════════════════════════════
    //  Init
    // ══════════════════════════════════════════════════════════
    function init() {
        if (document.querySelector('.flow-header')) return; // idempotente
        build();
        document.body.classList.add('flow-nav-on');

        // Restaura estado persistido
        var savedStep = 0, savedWs = 'operacao';
        try {
            var s = parseInt(localStorage.getItem(LS_STEP), 10);
            if (!isNaN(s) && s >= 0 && s < STEPS.length) savedStep = s;
            var w = localStorage.getItem(LS_WS);
            if (w === 'imbel' || w === 'operacao' || w === 'relacionamento' || w === 'ponto' || w === 'processos') savedWs = w;
            if (w === 'negocio') savedWs = 'relacionamento'; // migração do nome antigo do workspace
        } catch (e) {}
        currentStep = savedStep;

        document.addEventListener('keydown', onKey);
        els.wsBtns.forEach(function (b) {
            b.addEventListener('click', function () { setWorkspace(b.getAttribute('data-ws')); });
        });
        window.addEventListener('resize', adjustHeaderHeight);

        // Aplica workspace inicial (dispara a navegação da etapa/aba correta)
        setWorkspace(savedWs);
        setTimeout(adjustHeaderHeight, 100);

        // Expõe API mínima para depuração
        window.FluxoNav = { goStep: goStep, setWorkspace: setWorkspace, get step() { return currentStep; } };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
