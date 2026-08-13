/**
 * Testes de comportamento das regras do Firestore e do Storage.
 *
 * Rodam contra os emuladores, não contra o projeto real — nenhum dado de
 * produção é tocado. Como dependem do emulador, ficam fora do `npm test`
 * (ver exclude em vitest.config.js) e são executados por:
 *
 *     npm run test:rules
 *
 * O que está sendo protegido aqui: o controle de admin do app é inteiramente
 * client-side (`isCurrentUserAdmin()` lê de localStorage), então estas regras
 * são a única barreira real de escrita. Se alguém afrouxá-las por engano, o
 * teste "usuário comum NÃO pode gravar" quebra.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const RAIZ = resolve(__dirname, '..', '..');
const EMAIL_DONO = 'joffre.ribeiro@gmail.com';

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: 'estoquefi',
        firestore: {
            rules: readFileSync(resolve(RAIZ, 'firestore.rules'), 'utf8'),
            host: '127.0.0.1',
            port: 8080
        }
    });
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
});

// Atalhos para os perfis de usuário que as regras precisam distinguir.
const comoAnonimo = () => testEnv.unauthenticatedContext().firestore();
const comoUsuario = () =>
    testEnv.authenticatedContext('uid-comum', {
        email: 'colaborador@empresa.com',
        email_verified: true
    }).firestore();
const comoAdminClaim = () =>
    testEnv.authenticatedContext('uid-admin', {
        admin: true,
        email: 'admin@empresa.com',
        email_verified: true
    }).firestore();
const comoDonoPorEmail = () =>
    testEnv.authenticatedContext('uid-dono', {
        email: EMAIL_DONO,
        email_verified: true
    }).firestore();
const comoDonoEmailNaoVerificado = () =>
    testEnv.authenticatedContext('uid-falso', {
        email: EMAIL_DONO,
        email_verified: false
    }).firestore();

const docLatest = (db) => doc(db, 'app_data', 'latest');
const payload = { estado: { teste: true } };

describe('app_data — leitura', () => {
    it('nega leitura para quem não está autenticado', async () => {
        await assertFails(getDoc(docLatest(comoAnonimo())));
    });

    it('permite leitura para qualquer usuário autenticado', async () => {
        await assertSucceeds(getDoc(docLatest(comoUsuario())));
    });
});

describe('app_data — escrita', () => {
    it('nega escrita para quem não está autenticado', async () => {
        await assertFails(setDoc(docLatest(comoAnonimo()), payload));
    });

    // Este é o buraco que as regras fecham: hoje o usuário só precisa forjar
    // o localStorage para passar por todos os requireAdminOrNotify() do app.
    it('nega escrita para usuário autenticado sem privilégio de admin', async () => {
        await assertFails(setDoc(docLatest(comoUsuario()), payload));
    });

    it('permite escrita para quem tem a custom claim admin', async () => {
        await assertSucceeds(setDoc(docLatest(comoAdminClaim()), payload));
    });
});

describe('fallback por e-mail do dono', () => {
    // Sem este braço, publicar as regras tiraria a escrita do dono caso a
    // custom claim ainda não esteja definida na conta.
    it('permite escrita para o e-mail do dono quando verificado', async () => {
        await assertSucceeds(setDoc(docLatest(comoDonoPorEmail()), payload));
    });

    // Impede que uma conta criada com o mesmo endereço, mas sem confirmação,
    // herde o privilégio.
    it('nega escrita para o mesmo e-mail se não estiver verificado', async () => {
        await assertFails(setDoc(docLatest(comoDonoEmailNaoVerificado()), payload));
    });
});

describe('coleções não declaradas', () => {
    it('nega leitura e escrita mesmo para admin', async () => {
        const db = comoAdminClaim();
        await assertFails(getDoc(doc(db, 'colecao_inexistente', 'x')));
        await assertFails(setDoc(doc(db, 'colecao_inexistente', 'x'), payload));
    });
});
