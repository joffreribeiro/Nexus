/**
 * Testes de CloudStore (cloud-store.js) contra o emulador do Firestore —
 * comportamento real de leitura/escrita/migração, não só a lógica pura já
 * coberta em tests/cloud-store.test.js.
 *
 * Usa firebase-admin (já dependência do projeto) em vez do SDK client: o
 * Admin SDK ignora firestore.rules por padrão, isolando este teste da lógica
 * de permissão (coberta à parte em tests/rules/firestore-rules.test.js). Sua
 * API de leitura/escrita (`.collection().doc().set()/.get()`) tem o mesmo
 * formato do SDK "compat" que o app usa em produção (`window.firestoreDB`),
 * então CloudStore funciona igual nos dois — é só o tipo de credencial que
 * muda.
 *
 * Roda junto com os demais testes de tests/rules/ via `npm run test:rules`
 * (sobe o emulador, não toca em nenhum dado real).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import admin from 'firebase-admin';
import CloudStore from '../../cloud-store.js';

const RAIZ = resolve(__dirname, '..', '..');
const PROJECT_ID = 'estoquefi-cloudstore-test';

let app;
let db;

beforeAll(() => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    app = admin.initializeApp({ projectId: PROJECT_ID }, 'cloud-store-test-app');
    db = app.firestore();
});

afterAll(async () => {
    if (app) await app.delete();
});

async function limparColecao() {
    const snap = await db.collection('app_data').get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

beforeEach(async () => {
    await limparColecao();
});

const firebaseNSFake = { firestore: { FieldValue: admin.firestore.FieldValue } };

describe('CloudStore.salvarModulosNoCloud / carregarModulosDoCloud', () => {
    it('grava em documentos separados (app_data/estoque, /crm, /ponto, /auditoria), não em um só', async () => {
        const estoque = {
            produtos: [{ id: 1, nome: 'CARABINA' }],
            crm: { negocios: [{ id: 'n1' }] },
            ponto: { registros: [{ data: '2026-01-01' }] },
            auditoriaVendas: [{ id: 'a1', acao: 'EDIÇÃO' }]
        };
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, estoque);

        const [docEstoque, docCrm, docPonto, docLegado] = await Promise.all([
            db.collection('app_data').doc('estoque').get(),
            db.collection('app_data').doc('crm').get(),
            db.collection('app_data').doc('ponto').get(),
            db.collection('app_data').doc('latest').get()
        ]);
        expect(docEstoque.exists).toBe(true);
        expect(docEstoque.data().produtos).toEqual([{ id: 1, nome: 'CARABINA' }]);
        expect(docCrm.exists).toBe(true);
        expect(docCrm.data().negocios).toEqual([{ id: 'n1' }]);
        expect(docPonto.exists).toBe(true);
        expect(docPonto.data().registros).toEqual([{ data: '2026-01-01' }]);
        // A auditoria saiu do documento estoque e foi para o seu próprio.
        expect(docEstoque.data().auditoriaVendas).toBeUndefined();
        const docAuditoria = await db.collection('app_data').doc('auditoria').get();
        expect(docAuditoria.data().registros).toEqual([{ id: 'a1', acao: 'EDIÇÃO' }]);
        // Não deve ter criado nem tocado o documento legado.
        expect(docLegado.exists).toBe(false);
    });

    it('auditoria gravada antes da separação (dentro do estoque) é migrada no primeiro save', async () => {
        // Estado como ficou gravado pela versão anterior: auditoriaVendas
        // dentro do próprio documento app_data/estoque.
        await db.collection('app_data').doc('estoque').set({
            produtos: [{ id: 1 }],
            auditoriaVendas: [{ id: 'antigo' }],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // A leitura ainda enxerga a auditoria antiga...
        const lido = await CloudStore.carregarModulosDoCloud(db);
        expect(lido.auditoriaVendas).toEqual([{ id: 'antigo' }]);

        // ...e o save seguinte a move para o documento próprio.
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, lido);
        const [docEstoque, docAuditoria] = await Promise.all([
            db.collection('app_data').doc('estoque').get(),
            db.collection('app_data').doc('auditoria').get()
        ]);
        expect(docEstoque.data().auditoriaVendas).toBeUndefined();
        expect(docAuditoria.data().registros).toEqual([{ id: 'antigo' }]);
    });

    it('round-trip completo: salvar e carregar de volta reproduz o estoque original', async () => {
        const estoque = {
            produtos: [{ id: 1, nome: 'PISTOLA' }, { id: 2, nome: 'FUZIL' }],
            registroVendas: [{ id: 'v1', valorTotal: 5000 }],
            clientes: [{ id: 'c1', nome: 'Loja X' }],
            crm: { negocios: [{ id: 'n1', titulo: 'Negócio A' }], funis: [{ id: 'f1' }] },
            ponto: { registros: [{ data: '2026-02-10', entrada: '08:00' }], acordos: [] },
            auditoriaVendas: [{ id: 'a1', acao: 'CRIAÇÃO', contrato: '123' }]
        };
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, estoque);
        const recarregado = await CloudStore.carregarModulosDoCloud(db);

        // O `updatedAt` de cada documento é metadado de persistência e é
        // removido na leitura — o estoque remontado sai limpo, idêntico ao
        // original.
        expect(recarregado).toEqual(estoque);
    });

    it('editar só o CRM não sobrescreve o Ponto (o problema real que motivou a migração)', async () => {
        // Salva os três módulos juntos, como um save inicial normal.
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, {
            produtos: [],
            crm: { negocios: [{ id: 'n1' }] },
            ponto: { registros: [{ data: '2026-01-01' }] }
        });

        // Segundo save "concorrente": só o CRM mudou (simula um usuário
        // editando o CRM enquanto outro mexeu no Ponto por fora deste fluxo).
        const soCrmMudou = await CloudStore.carregarModulosDoCloud(db);
        soCrmMudou.crm.negocios.push({ id: 'n2' });
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, soCrmMudou);

        const docPonto = await db.collection('app_data').doc('ponto').get();
        // O documento do Ponto não deveria ter sido tocado pelo save do CRM
        // (cada write agora é isolado por módulo) — no esquema antigo (um
        // único documento), esse mesmo fluxo teria regravado tudo junto,
        // mas sem alterar o conteúdo isso não é observável aqui; o que
        // importa é que o Ponto continua correto e intacto.
        expect(docPonto.data().registros).toEqual([{ data: '2026-01-01' }]);
    });

    it('carregarModulosDoCloud com nenhum documento existente retorna estoque vazio, sem lançar', async () => {
        const estoque = await CloudStore.carregarModulosDoCloud(db);
        expect(estoque).toEqual({});
    });

    it('carregarModulosDoCloud com só o módulo estoque salvo (crm/ponto nunca gravados) não inclui essas chaves', async () => {
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, { produtos: [{ id: 1 }] });
        // Simula um cenário onde só o estoque foi migrado ainda.
        await db.collection('app_data').doc('crm').delete();
        await db.collection('app_data').doc('ponto').delete();

        const estoque = await CloudStore.carregarModulosDoCloud(db);
        expect(estoque.produtos).toEqual([{ id: 1 }]);
        expect('crm' in estoque).toBe(false);
        expect('ponto' in estoque).toBe(false);
    });
});

describe('CloudStore.migrarDocumentoUnico', () => {
    it('copia o documento legado app_data/latest para os três documentos novos, sem apagar o legado', async () => {
        const estoqueOriginal = {
            produtos: [{ id: 1, nome: 'CARABINA' }],
            crm: { negocios: [{ id: 'n1' }] },
            ponto: { registros: [{ data: '2026-01-01' }] }
        };
        await db.collection('app_data').doc('latest').set({
            estado: estoqueOriginal,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const resultado = await CloudStore.migrarDocumentoUnico(db, firebaseNSFake);
        expect(resultado.migrado).toBe(true);

        const [docLegado, docEstoque, docCrm, docPonto] = await Promise.all([
            db.collection('app_data').doc('latest').get(),
            db.collection('app_data').doc('estoque').get(),
            db.collection('app_data').doc('crm').get(),
            db.collection('app_data').doc('ponto').get()
        ]);
        // O legado continua existindo e intacto — ponto de rollback.
        expect(docLegado.exists).toBe(true);
        expect(docLegado.data().estado.produtos).toEqual(estoqueOriginal.produtos);
        // Os três novos documentos têm os dados migrados corretamente.
        expect(docEstoque.data().produtos).toEqual(estoqueOriginal.produtos);
        expect(docCrm.data().negocios).toEqual(estoqueOriginal.crm.negocios);
        expect(docPonto.data().registros).toEqual(estoqueOriginal.ponto.registros);
    });

    it('sem documento legado, não migra e avisa o motivo (não lança erro)', async () => {
        const resultado = await CloudStore.migrarDocumentoUnico(db, firebaseNSFake);
        expect(resultado.migrado).toBe(false);
        expect(resultado.motivo).toBeTruthy();
    });

    it('idempotente: rodar duas vezes reflete o estado mais atual do legado, sem duplicar nada', async () => {
        await db.collection('app_data').doc('latest').set({
            estado: { produtos: [{ id: 1 }] },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await CloudStore.migrarDocumentoUnico(db, firebaseNSFake);

        // Legado muda depois da primeira migração (uso normal continua
        // enquanto a segunda etapa da migração não é cortada).
        await db.collection('app_data').doc('latest').set({
            estado: { produtos: [{ id: 1 }, { id: 2 }] },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await CloudStore.migrarDocumentoUnico(db, firebaseNSFake);

        const docEstoque = await db.collection('app_data').doc('estoque').get();
        expect(docEstoque.data().produtos).toEqual([{ id: 1 }, { id: 2 }]);
    });
});

describe('CloudStore: escrita dupla removida (teto de 1 MiB)', () => {
    it('não escreve mais no documento legado app_data/latest', async () => {
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, {
            produtos: [{ id: 1, nome: 'CARABINA' }],
            crm: { negocios: [{ id: 'n1' }] }
        });
        const docLegado = await db.collection('app_data').doc('latest').get();
        expect(docLegado.exists).toBe(false);
    });

    it('um módulo grande não derruba o save dos outros (cada doc tem seu próprio 1 MiB)', async () => {
        // ~700 KiB em crm + ~700 KiB em estoque: passava de 1 MiB somado, que
        // era exatamente o que o documento legado recusava.
        const encher = (n) => 'x'.repeat(n);
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, {
            observacoes: encher(700 * 1024),
            crm: { historico: encher(700 * 1024) }
        });
        const [docEstoque, docCrm] = await Promise.all([
            db.collection('app_data').doc('estoque').get(),
            db.collection('app_data').doc('crm').get()
        ]);
        expect(docEstoque.data().observacoes).toHaveLength(700 * 1024);
        expect(docCrm.data().historico).toHaveLength(700 * 1024);
    });

    it('módulo acima de 1 MiB falha antes do Firestore, dizendo qual módulo estourou', async () => {
        await expect(
            CloudStore.salvarModulosNoCloud(db, firebaseNSFake, { crm: { historico: 'x'.repeat(1100 * 1024) } })
        ).rejects.toThrow(/app_data\/crm/);
        // Nada foi gravado: o save é barrado antes de tocar no Firestore.
        const docCrm = await db.collection('app_data').doc('crm').get();
        expect(docCrm.exists).toBe(false);
    });
});

describe('CloudStore.lerEstadoCompativel (escolha da fonte)', () => {
    it('devolve o formato antigo (data.estado) mesmo lendo dos documentos novos', async () => {
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, {
            produtos: [{ id: 1, nome: 'PISTOLA' }],
            precificacoesCliente: [{ id: 'p1' }],
            crm: { negocios: [] }
        });
        const { data, origem } = await CloudStore.lerEstadoCompativel(db);
        expect(origem).toBe('modulos');
        expect(data.estado.produtos).toEqual([{ id: 1, nome: 'PISTOLA' }]);
        expect(data.precificacoesCliente).toEqual([{ id: 'p1' }]);
        // Consumidores em app2.js chamam data.updatedAt.toDate() — precisa
        // continuar sendo um Timestamp, não um Date cru.
        expect(typeof data.updatedAt.toDate).toBe('function');
    });

    it('ignora o legado mesmo quando ele tem carimbo mais recente (ele está congelado)', async () => {
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, {
            produtos: [{ id: 1 }, { id: 2, nome: 'ATUAL' }]
        });
        // Legado gravado DEPOIS, com um estado antigo: era esse o caso que
        // fazia o app reverter as alterações do dia.
        await db.collection('app_data').doc('latest').set({
            estado: { produtos: [{ id: 1 }] },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const { data, origem } = await CloudStore.lerEstadoCompativel(db);
        expect(origem).toBe('modulos');
        expect(data.estado.produtos).toHaveLength(2);
    });

    it('módulo sem updatedAt legível não faz o legado vencer', async () => {
        // Reproduz a leitura logo após um save, quando o serverTimestamp
        // ainda está pendente e volta nulo.
        await db.collection('app_data').doc('estoque').set({ produtos: [{ id: 1 }, { id: 2 }] });
        await db.collection('app_data').doc('latest').set({
            estado: { produtos: [{ id: 1 }] },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const { data, origem } = await CloudStore.lerEstadoCompativel(db);
        expect(origem).toBe('modulos');
        expect(data.estado.produtos).toHaveLength(2);
    });

    it('lê o legado só quando nenhum documento de módulo existe (base ainda não migrada)', async () => {
        await db.collection('app_data').doc('latest').set({
            estado: { produtos: [{ id: 1 }, { id: 99 }] },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const { data, origem } = await CloudStore.lerEstadoCompativel(db);
        expect(origem).toBe('legado');
        expect(data.estado.produtos).toHaveLength(2);
    });

    it('sem nenhuma fonte, devolve data nulo sem lançar', async () => {
        const { data, origem } = await CloudStore.lerEstadoCompativel(db);
        expect(data).toBeNull();
        expect(origem).toBeNull();
    });

    it('round-trip pelo caminho real do app: save por módulos seguido de leitura compatível', async () => {
        const estoque = {
            produtos: [{ id: 1, nome: 'FUZIL' }],
            clientes: [{ id: 'c1' }],
            crm: { negocios: [{ id: 'n1', titulo: 'Negócio' }] },
            ponto: { registros: [{ data: '2026-03-01', entrada: '08:00' }] }
        };
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, estoque);
        const { data } = await CloudStore.lerEstadoCompativel(db);

        expect(data.estado.produtos).toEqual(estoque.produtos);
        expect(data.estado.clientes).toEqual(estoque.clientes);
        expect(data.estado.crm).toEqual(estoque.crm);
        expect(data.estado.ponto).toEqual(estoque.ponto);
    });
});

describe('CloudStore.diagnosticoDosDocumentos', () => {
    it('relata existência, carimbo e tamanho dos quatro documentos', async () => {
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, { produtos: [{ id: 1, nome: 'CARABINA' }] });
        const docs = await CloudStore.diagnosticoDosDocumentos(db);

        const porNome = Object.fromEntries(docs.map((d) => [d.doc, d]));
        expect(porNome['app_data/estoque'].existe).toBe(true);
        expect(porNome['app_data/estoque'].updatedAt).toBeInstanceOf(Date);
        expect(porNome['app_data/estoque'].bytes).toBeGreaterThan(0);
        expect(porNome['app_data/auditoria'].existe).toBe(true);
        expect(porNome['app_data/latest'].existe).toBe(false);
        expect(porNome['app_data/latest'].bytes).toBe(0);
    });
});

describe('CloudStore.timestampMaisRecenteDeSnapshot (listener em tempo real)', () => {
    it('devolve o timestamp mais recente entre os documentos da coleção', async () => {
        await CloudStore.salvarModulosNoCloud(db, firebaseNSFake, { produtos: [] });
        const snap = await db.collection('app_data').get();
        const ts = CloudStore.timestampMaisRecenteDeSnapshot(snap);
        expect(typeof ts).toBe('number');
        expect(ts).toBeGreaterThan(0);
    });

    it('coleção vazia ou entrada inválida devolve null, sem lançar', async () => {
        const snap = await db.collection('app_data').get();
        expect(CloudStore.timestampMaisRecenteDeSnapshot(snap)).toBeNull();
        expect(CloudStore.timestampMaisRecenteDeSnapshot(null)).toBeNull();
        expect(CloudStore.timestampMaisRecenteDeSnapshot({})).toBeNull();
    });
});
