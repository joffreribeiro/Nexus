#!/usr/bin/env node
/**
 * scripts/stamp-versions.js
 *
 * Substitui o `?v=` manual dos scripts/estilos locais referenciados em
 * index.html por um hash do conteúdo de cada arquivo (8 primeiros hex do
 * SHA-256). Resolve o cache-busting manual — ~20 tags do tipo `?v=37`,
 * `?v=40`, `?v=20260625-02`, cada uma incrementada à mão — onde esquecer de
 * bumpar uma tag deixa o usuário com JS velho e CSS novo ao mesmo tempo,
 * produzindo bugs difíceis de reproduzir.
 *
 * Não introduz build step: index.html continua sendo servido como está, com
 * script tags soltas, sem bundler. Rode este script antes de cada deploy (ou
 * em CI, com --check) e os `?v=` ficam sempre corretos — o hash de uma tag só
 * muda quando o conteúdo do arquivo correspondente muda.
 *
 * Só toca tags cujo `src`/`href` aponta para um arquivo local (sem `http`);
 * CDNs (jsdelivr, cdnjs, gstatic) e data URIs (favicon) ficam de fora por
 * construção — o padrão exige que o valor comece com um nome de arquivo, não
 * com esquema de URL.
 *
 * Uso:
 *   node scripts/stamp-versions.js         # aplica as mudanças em index.html
 *   node scripts/stamp-versions.js --check # só verifica; sai com erro (útil em CI/pre-commit)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX_HTML = path.join(ROOT, 'index.html');
const CHECK_MODE = process.argv.includes('--check');

// Casa src="arquivo.js" / href="arquivo.css", com ou sem "?v=..." atual.
// O grupo do nome de arquivo não aceita "/" nem ":" — por isso URLs de CDN
// (que começam com "https://...") nunca batem aqui.
const TAG_RE = /(src|href)="([a-zA-Z0-9_.-]+\.(?:js|css))(?:\?v=[^"]*)?"/g;

function hashFile(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function main() {
    const original = fs.readFileSync(INDEX_HTML, 'utf8');
    const naoEncontrados = [];
    let alteradas = 0;

    const atualizado = original.replace(TAG_RE, (match, attr, filename) => {
        const filePath = path.join(ROOT, filename);
        if (!fs.existsSync(filePath)) {
            naoEncontrados.push(filename);
            return match;
        }
        const novaTag = `${attr}="${filename}?v=${hashFile(filePath)}"`;
        if (novaTag !== match) alteradas++;
        return novaTag;
    });

    if (naoEncontrados.length) {
        console.error(
            'Arquivos referenciados em index.html mas não encontrados no disco (corrija antes de continuar):\n  ' +
            naoEncontrados.join('\n  ')
        );
        process.exitCode = 1;
        return;
    }

    if (CHECK_MODE) {
        if (atualizado !== original) {
            console.error(
                `index.html tem versão(ões) desatualizada(s) em relação ao conteúdo atual dos arquivos.\n` +
                `Rode: node scripts/stamp-versions.js`
            );
            process.exitCode = 1;
        } else {
            console.log('OK: todas as versões em index.html refletem o conteúdo atual dos arquivos.');
        }
        return;
    }

    if (alteradas > 0) {
        fs.writeFileSync(INDEX_HTML, atualizado, 'utf8');
        console.log(`${alteradas} tag(s) atualizada(s) em index.html.`);
    } else {
        console.log('Nenhuma tag precisou ser atualizada — todos os hashes já batem com o conteúdo atual.');
    }
}

main();
