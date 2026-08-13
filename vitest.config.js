import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Os testes de regras precisam dos emuladores do Firebase rodando, então
    // não entram no `npm test`. Use `npm run test:rules` (ver package.json).
    exclude: ['tests/rules/**']
  }
});
