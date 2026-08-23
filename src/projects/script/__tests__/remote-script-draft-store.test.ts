import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);
const downstream = vi.hoisted(() => ({ sync: vi.fn() }));

function identityKey(namespace: string, key: string) {
  return `${namespace}/${key}`;
}

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  isRemoteRevisionConflict: (error: unknown) =>
    error instanceof Error && error.message === 'REVISION_CONFLICT',
  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
    const document = documents.get(identityKey(namespace, key));
    return document
      ? {
          namespace,
          key,
          revision: document.revision,
          value: structuredClone(document.value),
          updatedAt: new Date().toISOString(),
        }
      : null;
  }),
  putRemoteDocument: vi.fn(
    async (input: {
      namespace: string;
      key: string;
      expectedRevision?: number;
      value: unknown;
    }) => {
      const id = identityKey(input.namespace, input.key);
      const current = documents.get(id);
      const expected = input.expectedRevision ?? 0;
      if ((current?.revision ?? 0) !== expected) {
        throw new Error('REVISION_CONFLICT');
      }
      const revision = (current?.revision ?? 0) + 1;
      documents.set(id, {
        revision,
        value: structuredClone(input.value),
      });
      return {
        namespace: input.namespace,
        key: input.key,
        revision,
        value: structuredClone(input.value),
        updatedAt: new Date().toISOString(),
      };
    },
  ),
  putRemoteDocumentsAtomic: vi.fn(async (input: {
    writes: Array<{
      namespace: string;
      key: string;
      expectedRevision: number;
      value: unknown;
    }>;
  }) => {
    for (const write of input.writes) {
      const current = documents.get(identityKey(write.namespace, write.key));
      if ((current?.revision ?? 0) !== write.expectedRevision) {
        throw new Error('REVISION_CONFLICT');
      }
    }
    return {
      documents: input.writes.map((write) => {
        const id = identityKey(write.namespace, write.key);
        const current = documents.get(id);
        const revision = (current?.revision ?? 0) + 1;
        documents.set(id, {
          revision,
          value: structuredClone(write.value),
        });
        return {
          namespace: write.namespace,
          key: write.key,
          revision,
          value: structuredClone(write.value),
          updatedAt: new Date().toISOString(),
        };
      }),
    };
  }),
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, 'http://go-backend.internal');
    if ((init.method ?? 'GET') === 'POST') {
      const draft = JSON.parse(String(init.body)) as Record<string, unknown>;
      const projectId =
        (typeof draft.projectId === 'string' && draft.projectId) ||
        url.searchParams.get('projectId') ||
        '';
      const id = identityKey('script-drafts', projectId);
      const current = documents.get(id);
      const next = {
        ...draft,
        updatedAt: new Date().toISOString(),
      };
      documents.set(id, {
        revision: (current?.revision ?? 0) + 1,
        value: structuredClone(next),
      });
      return Response.json({ draft: next });
    }
    const projectId = url.searchParams.get('projectId') ?? '';
    const id = identityKey('script-drafts', projectId);
    return Response.json({
      draft: structuredClone(documents.get(id)?.value ?? null),
    });
  }),
}));
vi.mock('@/projects/script/script-draft-invalidation', () => ({
  invalidateProductionsAfterScriptSave: vi.fn(async () => undefined),
}));
vi.mock('@/projects/workspace-sync/sync-management-to-workspace', () => ({
  syncManagementToWorkspace: downstream.sync,
}));

import {
  loadScriptDraft,
  saveScriptDraft,
} from '@/projects/script/script-draft-store';
import { synchronizeScriptDraftDownstream } from '@/projects/script/script-draft-downstream';

function draft(projectId: string, title: string) {
  return {
    projectId,
    sourceText: `第1集\n${title}`,
    episodes: [
      {
        id: `${projectId}-ep-1`,
        episodeNumber: 1,
        title,
        content: `${title}正文`,
        wordCount: 4,
        status: 'saved',
      },
    ],
    selectedId: `${projectId}-ep-1`,
  };
}

function scriptDraftKeys() {
  return [...documents.keys()].filter((key) => key.startsWith('script-drafts/'));
}

describe('remote script draft store', () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = '';

  beforeEach(() => {
    const root =
      process.env.IC_TEST_TMP_ROOT ||
      path.join('E:', 'DevWorkspace', 'runtime', 'test-tmp');
    mkdirSync(root, { recursive: true });
    tmp = mkdtempSync(path.join(root, 'ic-remote-script-'));
    process.env.APP_DATA_DIR = tmp;
    process.env.REMOTE_DATA_ONLY = 'true';
    documents.clear();
    downstream.sync.mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('normalizes, saves and loads through the public store', async () => {
    const saved = await saveScriptDraft(draft('p_1', '第一集'));
    expect(saved.projectId).toBe('p_1');
    expect(saved.episodes[0]?.title).toBe('第一集');
    expect(saved.novelTask.projectId).toBe('p_1');
    expect((await loadScriptDraft('p_1'))?.episodes[0]?.content).toBe(
      '第一集正文',
    );
  });

  it('isolates drafts by project', async () => {
    await saveScriptDraft(draft('p_1', '一号'));
    await saveScriptDraft(draft('p_2', '二号'));
    expect((await loadScriptDraft('p_1'))?.episodes[0]?.title).toBe('一号');
    expect((await loadScriptDraft('p_2'))?.episodes[0]?.title).toBe('二号');
  });

  it('preserves outline and split review state', async () => {
    const saved = await saveScriptDraft({
      ...draft('p_1', '第一集'),
      outlineText: '剧本大纲',
      episodeSplit: {
        status: 'review',
        sourceFingerprint: 'a'.repeat(64),
        generationId: null,
        proposedEpisodes: [],
        generatedAt: new Date().toISOString(),
        errorMessage: null,
      },
    });
    expect(saved.outlineText).toBe('剧本大纲');
    expect(saved.episodeSplit?.status).toBe('review');
  });

  it('updates an existing remote draft without duplicating documents', async () => {
    await saveScriptDraft(draft('p_1', '旧标题'));
    const previous = await loadScriptDraft('p_1');
    await saveScriptDraft({
      ...draft('p_1', '新标题'),
      documentRevision: previous?.documentRevision,
    });
    expect((await loadScriptDraft('p_1'))?.episodes[0]?.title).toBe('新标题');
    expect(scriptDraftKeys()).toEqual(['script-drafts/p_1']);
  });

  it('refreshes the remote workspace snapshot without a standalone invalidate helper', async () => {
    downstream.sync.mockResolvedValue({ ok: true, revision: 1 });
    const result = await synchronizeScriptDraftDownstream({
      projectId: 'p_1',
      contentChanged: true,
      syncWhenUnchanged: true,
    });
    expect(result).toEqual({ deferred: true });
    expect(downstream.sync).toHaveBeenCalledWith('p_1');
  });
});
