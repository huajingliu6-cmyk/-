import { beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, 'http://go-backend.internal');
    const emptyCatalog = () => ({
      version: 1,
      draft: null,
      documents: [] as Array<Record<string, unknown>>,
      currentDocumentId: null as string | null,
    });
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        action: string;
        draft?: Record<string, unknown>;
        input?: Record<string, unknown>;
      };
      const projectId = String(body.draft?.projectId ?? body.input?.projectId ?? '');
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const snapshot = structuredClone(documents.get(projectId));
        const catalog = structuredClone(
          (snapshot?.value as ReturnType<typeof emptyCatalog> | undefined) ?? emptyCatalog(),
        );
        let result: Record<string, unknown>;
        if (body.action === 'saveDraft') {
          catalog.draft = structuredClone(body.draft ?? null) as never;
          result = { ok: true };
        } else {
          const input = body.input ?? {};
          const version = catalog.documents.reduce(
            (maximum, document) => Math.max(maximum, Number(document.version ?? 0)),
            0,
          ) + 1;
          const document = {
            ...input,
            documentId: `doc_${String(input.generationId).padEnd(12, '0').slice(0, 12)}`,
            version,
            createdAt: new Date().toISOString(),
          };
          catalog.documents.push(document);
          catalog.currentDocumentId = String(document.documentId);
          result = { document };
        }
        await Promise.resolve();
        if (documents.get(projectId)?.revision !== snapshot?.revision) continue;
        documents.set(projectId, {
          revision: (snapshot?.revision ?? 0) + 1,
          value: structuredClone(catalog),
        });
        return Response.json(result);
      }
      return Response.json({ error: 'project text write conflict' }, { status: 409 });
    }
    const projectId = url.searchParams.get('projectId') ?? '';
    const catalog = structuredClone(
      (documents.get(projectId)?.value as ReturnType<typeof emptyCatalog> | undefined) ?? emptyCatalog(),
    );
    if (url.searchParams.get('view') === 'draft') {
      return Response.json({ draft: catalog.draft });
    }
    if (url.searchParams.get('view') === 'current') {
      return Response.json({
        document:
          catalog.documents.find(
            (document) => document.documentId === catalog.currentDocumentId,
          ) ?? null,
      });
    }
    return Response.json({
      documents: catalog.documents.sort(
        (left, right) => Number(right.version) - Number(left.version),
      ),
    });
  }),
}));
import {
  getCurrentDocument,
  listDocumentVersions,
  loadStoryDraft,
  saveNewDocumentVersion,
  saveStoryDraft,
} from '@/text-generation/document-store';

const documentInput = (projectId: string, generationId: string) => ({
  projectId,
  rootFolderId: projectId,
  documentType: 'story' as const,
  title: '故事',
  content: `content-${generationId}`,
  createdBy: 'owner-1',
  modelKey: 'mock',
  providerModel: 'mock',
  targetChars: 300,
  actualChars: 100,
  inputTokens: null,
  outputTokens: null,
  generationId,
});

describe('remote text document store', () => {
  beforeEach(() => documents.clear());

  it('saves and loads a story draft through the public store', async () => {
    const draft = {
      projectId: 'p_1',
      brief: '远端灵感',
      outputKind: 'story' as const,
      modelKey: 'mock',
      targetChars: 300,
      updatedAt: new Date().toISOString(),
      resultText: '结果',
    };
    await saveStoryDraft(draft);
    expect(await loadStoryDraft('p_1')).toEqual(draft);
  });

  it('creates versions and updates the current document pointer', async () => {
    const first = await saveNewDocumentVersion(documentInput('p_1', 'g_1'));
    const second = await saveNewDocumentVersion(documentInput('p_1', 'g_2'));

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await getCurrentDocument('p_1'))?.documentId).toBe(second.documentId);
    expect((await listDocumentVersions('p_1')).map((doc) => doc.version)).toEqual([
      2,
      1,
    ]);
  });

  it('keeps draft data when a generated document is saved', async () => {
    await saveStoryDraft({
      projectId: 'p_1',
      brief: '保留草稿',
      outputKind: 'story',
      modelKey: 'mock',
      targetChars: 300,
      updatedAt: new Date().toISOString(),
    });
    await saveNewDocumentVersion(documentInput('p_1', 'g_1'));
    expect((await loadStoryDraft('p_1'))?.brief).toBe('保留草稿');
  });

  it('assigns unique sequential versions during concurrent saves', async () => {
    const saved = await Promise.all([
      saveNewDocumentVersion(documentInput('p_1', 'g_1')),
      saveNewDocumentVersion(documentInput('p_1', 'g_2')),
      saveNewDocumentVersion(documentInput('p_1', 'g_3')),
    ]);
    expect(saved.map((document) => document.version).sort()).toEqual([1, 2, 3]);
    expect(await listDocumentVersions('p_1')).toHaveLength(3);
  });

  it('isolates text catalogs by project', async () => {
    await saveStoryDraft({
      projectId: 'p_1',
      brief: '一号',
      outputKind: 'story',
      modelKey: 'mock',
      targetChars: 300,
      updatedAt: new Date().toISOString(),
    });
    await saveStoryDraft({
      projectId: 'p_2',
      brief: '二号',
      outputKind: 'story',
      modelKey: 'mock',
      targetChars: 300,
      updatedAt: new Date().toISOString(),
    });
    expect((await loadStoryDraft('p_1'))?.brief).toBe('一号');
    expect((await loadStoryDraft('p_2'))?.brief).toBe('二号');
  });
});
