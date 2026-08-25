/* ════════════════════════════════════════════════════════════════
   NAVEGAÇÃO EM FLUXO DE TRABALHO — controlador
   Constrói a barra global única (marca, workspace switch, esteira de 5
   etapas, busca, menu de Referência, status) do workspace Operação.
   Dirige o trocarAba() existente, sem tocar na lógica de renderização
   do app.

   Pipeline:  ① Estoque → ② Precificação → ③ Proposta → ④ Venda → ⑤ Envio
   Workspaces: Operação (fluxo) | IMBEL (separado)
   ════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var LS_STEP = 'fluxoNav.step';
    var LS_WS = 'fluxoNav.workspace';

    // ── Ícones (inline SVG, stroke currentColor) — dicionário único em icons.js ──
    var I = window.NexusIcons || {};

    // ── Etapas do pipeline (Operação) ──
    var STEPS = [
        { tab: 'estoque', t: 'Estoque', s: 'o que temos', icon: I.box },
        { tab: 'precificacao', t: 'Precificação', s: 'quanto cobrar', icon: I.tag },
        { tab: 'propostas', t: 'Proposta', s: 'montar oferta', icon: I.doc },
        { tab: 'vendas', t: 'Venda', s: 'fechar contrato', icon: I.cart },
        { tab: 'envio', t: 'Envio', s: 'doc. e entrega', icon: I.truck, emDesenvolvimento: true }
    ];

    // ── Telas de referência (fora do fluxo), achatadas em um único menu ──
    // sub: quando informado, reaproveita a Precificação e troca a sub-aba.
    // group: rótulo de seção não-clicável dentro do menu (ex.: "Cadastro").
    var REFS = [
        { label: 'Painel', tab: 'dashboard', icon: I.grid },
        { sep: true },
        { group: 'Cadastro' },
        { label: 'Clientes', tab: 'clientes', icon: I.users },
        { label: 'Distribuição', tab: 'distribuicao', icon: I.truck },
        { label: 'Produtos', tab: 'cadastro-produtos', icon: I.file },
        { label: 'Impostos', tab: 'precificacao', sub: 'impostos', icon: I.receipt },
        { label: 'Dados do Contrato', tab: 'cadastro', icon: I.file },
        { sep: true },
        { label: 'Rastreabilidade', tab: 'precificacao', sub: 'rastreabilidade', icon: I.link },
        { label: 'CI', tab: 'precificacao', sub: 'tabelaci', icon: I.dollar },
        { sep: true },
        { label: 'Relatórios', tab: 'relatorios', icon: I.chart }
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
                '</div>' +
                '<div class="ws-switch" role="tablist" aria-label="Workspace">' +
                    '<button class="ws-btn operacao active" data-ws="operacao" type="button" title="Operação">' + I.box + '<span>Operação</span></button>' +
                    '<button class="ws-btn relacionamento" data-ws="relacionamento" type="button" title="Relacionamento">' + I.heart + '<span>Relacionamento</span></button>' +
                    '<button class="ws-btn imbel" data-ws="imbel" type="button" title="IMBEL">' + I.shield + '<span>IMBEL</span></button>' +
                    '<button class="ws-btn ponto" data-ws="ponto" type="button" title="Ponto">' + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + '<span>Ponto</span></button>' +
                    '<button class="ws-btn processos" data-ws="processos" type="button" title="Processos">' + I.file + '<span>Processos</span></button>' +
                '</div>' +
                '<span class="flow-sep"></span>' +
                '<div class="pipetrack" role="tablist" aria-label="Etapas do fluxo"></div>' +
                '<div class="flow-tools">' +
                    '<button type="button" class="flow-search-btn" title="Busca global">' + (I.search || '') + '<span class="flow-search-kbd">Ctrl K</span></button>' +
                    '<div class="ref-dropdown">' +
                        '<button type="button" class="flow-ref-toggle">' + '<span>Referência</span>' + (I.chevron || '') + '</button>' +
                        '<div class="ref-dropdown-menu" aria-label="Telas de referência"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="flow-status"></div>' +
            '</div>';

        container.insertBefore(header, container.firstChild);

        els.header = header;
        els.globalbar = header.querySelector('.flow-globalbar');
        els.pipetrack = header.querySelector('.pipetrack');
        els.status = header.querySelector('.flow-status');
        els.wsBtns = header.querySelectorAll('.ws-btn[data-ws]');
        els.searchBtn = header.querySelector('.flow-search-btn');
        els.refWrap = header.querySelector('.ref-dropdown');
        els.refToggle = header.querySelector('.flow-ref-toggle');
        els.refMenu = header.querySelector('.ref-dropdown-menu');

        buildPipetrack();
        buildRefMenu();
        relocateStatusActions();
        ensureEnvioTab();

        els.searchBtn.addEventListener('click', function () {
            try { if (typeof window.abrirBuscaGlobal === 'function') window.abrirBuscaGlobal(); } catch (e) {}
        });
        els.refToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var wasOpen = els.refWrap.classList.contains('open');
            closeRefMenu();
            if (!wasOpen) els.refWrap.classList.add('open');
        });
    }

    function buildPipetrack() {
        STEPS.forEach(function (st, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pstep' + (st.emDesenvolvimento ? ' pstep-dev' : '');
            btn.setAttribute('data-step', i);
            btn.setAttribute('aria-current', 'false');
            btn.innerHTML =
                '<span class="pn">' + (i + 1) + '</span>' +
                '<span class="pt">' + st.t + '</span>' +
                '<span class="ps">' + st.s + '</span>';
            btn.addEventListener('click', function () { goStep(i); });
            els.pipetrack.appendChild(btn);
            stepBtns.push(btn);

            if (i < STEPS.length - 1) {
                var arrow = document.createElement('span');
                arrow.className = 'parrow';
                arrow.innerHTML = I.chevron || '';
                els.pipetrack.appendChild(arrow);
            }
        });
    }

    // Menu único de Referência — achata o antigo grupo "Cadastro" em uma
    // seção rotulada dentro do mesmo menu, em vez de um submenu aninhado.
    function buildRefMenu() {
        REFS.forEach(function (r) {
            if (r.sep) {
                var sep = document.createElement('div');
                sep.className = 'ref-dropdown-sep';
                els.refMenu.appendChild(sep);
                return;
            }
            if (r.group) {
                var lbl = document.createElement('div');
                lbl.className = 'ref-dropdown-group-lbl';
                lbl.textContent = r.group;
                els.refMenu.appendChild(lbl);
                return;
            }
            var itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = 'ref-dropdown-item';
            itemBtn.innerHTML = (r.icon || '') + '<span>' + r.label + '</span>';
            itemBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                closeRefMenu();
                goRef(r);
            });
            els.refMenu.appendChild(itemBtn);
            refBtns.push({ el: itemBtn, ref: r });
        });
    }

    function closeRefMenu() {
        if (els.refWrap) els.refWrap.classList.remove('open');
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

        // Atalho para a tela de Configurações (antes ficava solto na faixa de Referência)
        var cfgBtn = document.createElement('button');
        cfgBtn.type = 'button';
        cfgBtn.className = 'sidebar-action-btn';
        cfgBtn.innerHTML = I.gear + '<span class="nav-text">Configurações</span>';
        cfgBtn.addEventListener('click', function () {
            menu.classList.remove('open');
            clearRefActive();
            try { if (typeof window.trocarAba === 'function') window.trocarAba('configuracoes'); } catch (e) {}
        });
        drop.appendChild(cfgBtn);

        var cfgSep = document.createElement('div');
        cfgSep.className = 'flow-actions-sep';
        drop.appendChild(cfgSep);

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
        document.addEventListener('click', function () { menu.classList.remove('open'); closeRefMenu(); });
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
            btn.setAttribute('aria-current', 'false');
            var pn = btn.querySelector('.pn');
            if (i < currentStep) {
                btn.classList.add('done');
                if (pn) pn.innerHTML = I.check || '✓';
            } else {
                if (pn) pn.textContent = (i + 1);
                if (i === currentStep) { btn.classList.add('active'); btn.setAttribute('aria-current', 'step'); }
            }
        });
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
        refBtns.forEach(function (rb) { if (rb.ref === r) rb.el.classList.add('active'); });

        try {
            if (typeof window.trocarAba === 'function') window.trocarAba(r.tab);
            if (r.sub) {
                // Reaproveita a tela Precificação como container, sem a barra de sub-abas
                document.body.classList.add('flow-ref-precif');
                if (typeof window.trocarSubabaPrecif === 'function') window.trocarSubabaPrecif(r.sub);
            }
            if (r.anchor) {
                // Aguarda a troca de aba tornar o painel visível antes de rolar até ele
                setTimeout(function () {
                    var el = document.getElementById(r.anchor);
                    if (!el) return;
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    el.classList.add('cfg-anchor-flash');
                    setTimeout(function () { el.classList.remove('cfg-anchor-flash'); }, 1600);
                }, 60);
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
        var foraDoFluxo = imbel || relacionamento || ponto || processos;
        els.pipetrack.style.display = foraDoFluxo ? 'none' : '';
        els.refWrap.style.display = foraDoFluxo ? 'none' : '';
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
        document.addEventListener('click', closeRefMenu);
        els.wsBtns.forEach(function (b) {
            b.addEventListener('click', function () { setWorkspace(b.getAttribute('data-ws')); });
        });
        window.addEventListener('resize', adjustHeaderHeight);
        window.addEventListener('resize', closeRefMenu);
        window.addEventListener('scroll', closeRefMenu, true);

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
