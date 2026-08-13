/**
 * modal-a11y.js - Acessibilidade genérica para todos os modais (Controle-Estoque)
 *
 * O sistema tem ~40 funções abrirModalX()/fecharModalX() espalhadas por
 * app2.js, crm-ui.js e ponto-ui.js, usando famílias de visibilidade diferentes:
 *   - `.modal`, `.imbel-modal`, `.sel-overlay` → alternam `style.display`
 *                              entre 'none' e 'flex'
 *   - `.imbel-modal-overlay` → sempre `display:flex`; alterna a classe `.open`
 *                              (visibilidade real vem de opacity/pointer-events)
 *   - `.ponto-modal-backdrop`→ nem chega a existir no DOM quando fechado
 *                              (a função de render retorna '' e o HTML nunca é montado)
 *
 * Em vez de editar cada uma dessas ~40 funções para adicionar trap de foco e
 * Escape, este módulo observa o DOM (MutationObserver) e reage a qualquer
 * modal dessas famílias abrindo ou fechando, de onde quer que a chamada
 * tenha vindo. Nenhuma função existente precisa saber que isto existe.
 *
 * O que cada modal aberto ganha, automaticamente:
 *   - foco movido para o primeiro elemento focável ao abrir;
 *   - Tab/Shift+Tab presos dentro do modal (não escapa para o conteúdo atrás);
 *   - Esc aciona o botão de fechar do próprio modal (reaproveita a lógica de
 *     fechamento existente — inclusive limpeza de estado de edição — em vez
 *     de só escondê-lo);
 *   - foco devolvido a quem abriu o modal, ao fechar;
 *   - `role="dialog"` e `aria-modal="true"` quando ainda não declarados.
 *
 * Suporta modais aninhados (uma pilha, não uma variável única): fechar o do
 * topo devolve o foco ao modal de baixo, não a quem abriu o primeiro.
 */
(function () {
    // Famílias cuja visibilidade é lida via getComputedStyle (display/opacity/
    // pointer-events) em um elemento que já existe no DOM o tempo todo.
    // `.imbel-modal` (sem "-overlay") é usada por um único modal (Definir Preço,
    // imbel_preco_modal) que segue o mecanismo display:none/flex da família
    // `.modal`, não o de opacity/`.open` da `.imbel-modal-overlay`.
    // `.sel-overlay` é o seletor de produtos da Precificação (selProdModal),
    // mesmo mecanismo display:none/flex da família `.modal`.
    var SELETOR_ATRIBUTO = '.modal, .imbel-modal-overlay, .imbel-modal, .sel-overlay';
    // Famílias cuja visibilidade é a própria presença no DOM (montado/desmontado).
    var SELETOR_MONTAGEM = '.ponto-modal-backdrop';
    var SELETOR_TODOS = SELETOR_ATRIBUTO + ', ' + SELETOR_MONTAGEM;

    // Botões de fechar conhecidos, um por família (ver levantamento no topo).
    var SELETOR_BOTAO_FECHAR = '.close, .modal-close, .imbel-modal-close, .ponto-modal-fechar, .sel-close-btn, [data-modal-close]';

    var SELETOR_FOCAVEL =
        'a[href], button:not([disabled]), textarea:not([disabled]), ' +
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
        '[tabindex]:not([tabindex="-1"])';

    function estaVisivel(el) {
        if (!el || !el.isConnected) return false;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (parseFloat(cs.opacity) === 0) return false;
        if (cs.pointerEvents === 'none') return false;
        return true;
    }

    function focaveisDentro(container) {
        return Array.prototype.slice.call(container.querySelectorAll(SELETOR_FOCAVEL))
            .filter(function (el) { return el.offsetParent !== null; });
    }

    // Pilha de modais abertos (do mais antigo pro mais recente), pra lidar
    // corretamente com o caso raro de um modal abrir por cima de outro.
    var _pilha = [];

    function topoDaPilha() {
        return _pilha.length ? _pilha[_pilha.length - 1] : null;
    }

    function aoAbrirModal(modal) {
        if (_pilha.some(function (e) { return e.el === modal; })) return;
        _pilha.push({ el: modal, focoAnterior: document.activeElement });
        if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        var focaveis = focaveisDentro(modal);
        if (focaveis.length) focaveis[0].focus();
    }

    function aoFecharModal(modal) {
        var idx = -1;
        for (var i = 0; i < _pilha.length; i++) { if (_pilha[i].el === modal) { idx = i; break; } }
        if (idx === -1) return;
        var entrada = _pilha[idx];
        _pilha.splice(idx, 1);
        // Só devolve o foco se este era o modal do topo — fechar um modal no
        // meio da pilha (caso raro) não deveria roubar o foco de quem está
        // por cima dele.
        var eraTopo = idx === _pilha.length;
        if (eraTopo && entrada.focoAnterior && document.contains(entrada.focoAnterior)) {
            entrada.focoAnterior.focus();
        }
    }

    function verificarMudancaDeVisibilidade(el) {
        var visivelAgora = estaVisivel(el);
        var jaNaPilha = _pilha.some(function (e) { return e.el === el; });
        if (visivelAgora && !jaNaPilha) aoAbrirModal(el);
        else if (!visivelAgora && jaNaPilha) aoFecharModal(el);
    }

    // ── Observa atributos (style/class) nos modais que já existem no DOM ──
    var observerAtributos = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) { verificarMudancaDeVisibilidade(m.target); });
    });

    function observarAtributosDe(el) {
        observerAtributos.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
        // Estado inicial: se já nasceu visível (ex.: antes deste script rodar
        // no primeiro load), registra na pilha também.
        verificarMudancaDeVisibilidade(el);
    }

    document.querySelectorAll(SELETOR_ATRIBUTO).forEach(observarAtributosDe);

    // ── Observa o DOM inteiro por modais que são montados/desmontados
    //    (família .ponto-modal-backdrop) e por modais criados dinamicamente
    //    depois deste script já ter rodado (ex.: modalRoot recriado). ──
    function paraCadaCorrespondente(node, seletor, fn) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(seletor)) fn(node);
        if (node.querySelectorAll) {
            var achados = node.querySelectorAll(seletor);
            for (var i = 0; i < achados.length; i++) fn(achados[i]);
        }
    }

    new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            if (m.addedNodes) {
                for (var i = 0; i < m.addedNodes.length; i++) {
                    paraCadaCorrespondente(m.addedNodes[i], SELETOR_ATRIBUTO, observarAtributosDe);
                    // Montagem = já está aberto (não existe estado "montado e escondido").
                    paraCadaCorrespondente(m.addedNodes[i], SELETOR_MONTAGEM, aoAbrirModal);
                }
            }
            if (m.removedNodes) {
                for (var j = 0; j < m.removedNodes.length; j++) {
                    paraCadaCorrespondente(m.removedNodes[j], SELETOR_MONTAGEM, aoFecharModal);
                }
            }
        });
    }).observe(document.body, { childList: true, subtree: true });

    // ── Esc genérico + Tab preso dentro do modal do topo ──
    document.addEventListener('keydown', function (e) {
        var topo = topoDaPilha();
        if (!topo) return;
        var modal = topo.el;

        if (e.key === 'Escape') {
            var botaoFechar = modal.querySelector(SELETOR_BOTAO_FECHAR);
            if (botaoFechar) botaoFechar.click();
            // Sem botão de fechar conhecido: não força o fechamento (esconder
            // via display:none aqui puxaria por baixo do tapete qualquer
            // limpeza de estado que a função de abrir/fechar original faça).
            return;
        }

        if (e.key !== 'Tab') return;
        var focaveis = focaveisDentro(modal);
        if (!focaveis.length) return;
        var primeiro = focaveis[0];
        var ultimo = focaveis[focaveis.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
            e.preventDefault();
            ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
            e.preventDefault();
            primeiro.focus();
        }
    });

    window.ModalA11y = {
        modaisAbertos: function () { return _pilha.map(function (e) { return e.el; }); }
    };
})();
