/**
 * shared-state.js - Ponto único de acesso ao estado global do Estoque.
 *
 * Os módulos secundários (crm-store.js, ponto-store.js, processos-store.js)
 * dependem da variável `estoque` que app2.js cria — sem `let`/`var`/`const`,
 * o que a torna um global implícito do jeito antigo do JS (por isso ela
 * também está sempre acessível como `window.estoque`, mesmo sem nenhum dos
 * três arquivos declará-la).
 *
 * Até aqui, cada um desses três arquivos reimplementava a MESMA leitura
 * defensiva (`typeof estoque !== 'undefined' ? estoque : window.estoque`),
 * sem nenhum contrato formal entre eles — uma duplicação silenciosa que só
 * se percebe lendo os três arquivos lado a lado. Este arquivo formaliza
 * isso: um lugar só decide "como pegar o estoque", e os três passam a
 * chamar essa função em vez de reescrever a mesma lógica cada um.
 *
 * Isso NÃO elimina o acoplamento em si — os três módulos continuam
 * dependendo do formato de `estoque` que app2.js decide, e uma mudança
 * nesse formato ainda quebra os três. O que muda é que agora esse
 * acoplamento é explícito e está num lugar só: se `estoque` mudar de forma,
 * dá pra saber exatamente quem depende dele (quem chama
 * `NexusCore.getEstoque()`), em vez de descobrir quebrando em produção.
 * Desacoplar de verdade (cada módulo com seu próprio estado, sem depender
 * do global de app2.js) é um passo de arquitetura maior que isto só prepara.
 *
 * Deve carregar depois de app2.js (que cria `estoque`) e antes de
 * crm-store.js / ponto-store.js / processos-store.js.
 */
(function () {
    window.NexusCore = window.NexusCore || {};

    /**
     * Devolve o objeto `estoque` global do app, ou `null` se ainda não foi
     * inicializado (ex.: chamado antes do app2.js terminar de montar os
     * dados, ou script carregado fora de ordem). Nunca lança.
     */
    window.NexusCore.getEstoque = function () {
        try {
            return window.estoque || null;
        } catch (e) {
            return null;
        }
    };
})();
