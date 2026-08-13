/**
 * asset-loader.js - Carregamento sob demanda de scripts pesados (Controle-Estoque)
 *
 * Alguns recursos só fazem sentido quando o usuário aciona uma ação específica,
 * mas custam caro se baixados sempre. O caso motivador é a geração de documentos
 * .docx: `docx.min.js` (742 KB), `proposta_bg.js` (1,5 MB) e os dois logos em
 * base64 somam ~2,3 MB — mais da metade do peso do sistema — e só são usados por
 * `gerarDocxProposta()` e `gerarContratoVenda()`. Antes eles ficavam no <head>,
 * bloqueando a primeira renderização em toda abertura do sistema, inclusive nas
 * sessões (a maioria) que nunca geram documento nenhum.
 *
 * ATENÇÃO — carga única: esses arquivos declaram `const` no escopo global de
 * script (`const PROPOSTA_BG_B64 = ...`). Executar o mesmo arquivo duas vezes
 * lança SyntaxError de redeclaração. Por isso o cache abaixo guarda a *promessa*
 * e não o resultado: chamadas concorrentes (dois cliques rápidos) compartilham
 * o mesmo carregamento em vez de disparar dois <script> para o mesmo src.
 *
 * Sem dependências externas, sem build step — script solto como os demais.
 */
(function () {
    // src -> Promise. Só é limpo quando a carga falha, para permitir nova tentativa.
    var cache = {};

    /**
     * Carrega um <script> uma única vez.
     * @param {string} src
     * @returns {Promise<void>} resolve quando o script terminou de executar
     */
    function carregarScript(src) {
        if (cache[src]) return cache[src];

        cache[src] = new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src;
            // Preserva a ordem de execução entre scripts inseridos dinamicamente.
            el.async = false;
            el.onload = function () { resolve(); };
            el.onerror = function () {
                // onerror só dispara em falha de rede/404 — o script não chegou a
                // executar, então descartar o cache é seguro (não há const declarada).
                delete cache[src];
                reject(new Error('Falha ao carregar ' + src));
            };
            document.head.appendChild(el);
        });

        return cache[src];
    }

    /**
     * @param {string[]} listaSrc
     * @returns {Promise<void>}
     */
    function carregarScripts(listaSrc) {
        return Promise.all(listaSrc.map(carregarScript)).then(function () {});
    }

    // Tudo que a geração de .docx precisa: a biblioteca e as imagens em base64
    // embutidas no documento (fundo da proposta + logos).
    var ASSETS_DOCX = [
        'docx.min.js',
        'proposta_bg.js',
        'imbel_logo.js',
        'imbel_logo_black.js'
    ];

    /**
     * Garante que a biblioteca docx e seus assets estejam disponíveis.
     * Idempotente: da segunda chamada em diante resolve imediatamente.
     * @returns {Promise<void>}
     */
    function carregarDocx() {
        return carregarScripts(ASSETS_DOCX);
    }

    /**
     * Permite avisar o usuário ("preparando...") apenas na primeira geração,
     * quando a espera é real.
     * @returns {boolean}
     */
    function docxPronto() {
        return typeof window.docx !== 'undefined' && !!window.docx.Document;
    }

    window.AssetLoader = {
        carregarScript: carregarScript,
        carregarScripts: carregarScripts,
        carregarDocx: carregarDocx,
        docxPronto: docxPronto
    };
})();
