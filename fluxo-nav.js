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

    // ── Ícones (inline SVG, stroke currentColor) — dicionário único em icons.js ──
    var I = window.NexusIcons || {};

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
        { sep: true },
        { label: 'Cadastro', icon: I.file, items: [
            { label: 'Clientes', tab: 'clientes', icon: I.users },
            { label: 'Distribuição', tab: 'distribuicao', icon: I.truck },
            { label: 'Produtos', tab: 'cadastro-produtos', icon: I.file },
            { label: 'Impostos', tab: 'precificacao', sub: 'impostos', icon: I.receipt },
            { sep: true },
            { label: 'Dados do Contrato', tab: 'cadastro', icon: I.file }
        ] },
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
    var refBtns = [];         // { el, ref, parentEl? }
    var refDropdowns = [];    // wrappers .ref-dropdown, para fechar ao clicar fora

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
            if (r.items) {
                buildRefDropdown(r);
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

    // Grupo suspenso na faixa de referência (ex.: "Cadastro" reunindo Clientes/Impostos/Produtos).
    // O menu é anexado ao <body> (não ao .refbar) e posicionado via position:fixed, porque o
    // .refbar tem overflow-x:auto — o que força overflow-y para 'auto' também (regra do CSS2.1)
    // e cortaria um menu posicionado absoluto dentro dele.
    function buildRefDropdown(group) {
        var wrap = document.createElement('div');
        wrap.className = 'ref-dropdown';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ref-btn ref-dropdown-toggle';
        toggle.innerHTML = (group.icon || '') + '<span>' + group.label + '</span>' + I.chevron;
        wrap.appendChild(toggle);

        var menu = document.createElement('div');
        menu.className = 'ref-dropdown-menu';
        group.items.forEach(function (item) {
            if (item.sep) {
                var isep = document.createElement('div');
                isep.className = 'ref-dropdown-sep';
                menu.appendChild(isep);
                return;
            }
            var itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = 'ref-dropdown-item';
            itemBtn.innerHTML = (item.icon || '') + '<span>' + item.label + '</span>';
            itemBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                closeAllRefDropdowns();
                goRef(item);
            });
            menu.appendChild(itemBtn);
            refBtns.push({ el: itemBtn, ref: item, parentEl: toggle });
        });
        document.body.appendChild(menu);

        function positionMenu() {
            var r = toggle.getBoundingClientRect();
            menu.style.left = Math.round(r.left) + 'px';
            menu.style.top = Math.round(r.bottom + 6) + 'px';
        }

        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            var wasOpen = wrap.classList.contains('open');
            closeAllRefDropdowns();
            if (!wasOpen) {
                positionMenu();
                wrap.classList.add('open');
                menu.classList.add('open');
            }
        });

        els.refbar.appendChild(wrap);
        refDropdowns.push({ wrap: wrap, menu: menu });
    }

    function closeAllRefDropdowns() {
        refDropdowns.forEach(function (d) {
            d.wrap.classList.remove('open');
            d.menu.classList.remove('open');
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
        refBtns.forEach(function (rb) {
            rb.el.classList.remove('active');
            if (rb.parentEl) rb.parentEl.classList.remove('active');
        });
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
        // Marca o botão clicado (e o grupo suspenso pai, se houver)
        refBtns.forEach(function (rb) {
            if (rb.ref === r) {
                rb.el.classList.add('active');
                if (rb.parentEl) rb.parentEl.classList.add('active');
            }
        });

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
        document.addEventListener('click', closeAllRefDropdowns);
        els.wsBtns.forEach(function (b) {
            b.addEventListener('click', function () { setWorkspace(b.getAttribute('data-ws')); });
        });
        window.addEventListener('resize', adjustHeaderHeight);
        window.addEventListener('resize', closeAllRefDropdowns);
        window.addEventListener('scroll', closeAllRefDropdowns, true);

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
