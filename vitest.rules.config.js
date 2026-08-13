import { defineConfig } from 'vitest/config';

// Config separada para os testes de regras do Firebase: eles precisam dos
// emuladores no ar e por isso ficam fora do `npm test`. Rodar com
// `npm run test:rules`, que sobe os emuladores em volta desta suíte.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.js'],
    // Subir emulador + SDK é mais lento que os testes de cálculo puro.
    testTimeout: 20000,
    hookTimeout: 30000,
    // Uma instância só: as suítes compartilham o mesmo emulador e o
    // clearFirestore() entre testes.
    fileParallelism: false
  }
});
