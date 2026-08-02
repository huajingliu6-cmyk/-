import { beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);
const downstream = vi.hoisted(() => ({ invalidate: vi.fn(), sync: vi.fn() }));

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, 'http://go-backend.internal');
    if ((init.method ?? 'GET') === 'POST') {
      const draft = JSON.parse(String(init.body)) as Record<string, unknown>;
      const projectId = String(draft.projectId);
      const current = documents.get(projectId);
      const next = {
        ...draft,
        updatedAt: new Date().toISOString(),
      };
      documents.set(projectId, {
        revision: (current?.revision ?? 0) + 1,
        value: structuredClone(next),
      });
      return Response.json({ draft: next });
    }
    const projectId = url.searchParams.get('projectId') ?? '';
    return Response.json({
      draft: structuredClone(documents.get(projectId)?.value ?? null),
    });
  }),
}));
vi.mock('@/projects/script/script-draft-invalidation', () => ({
  invalidateWorkspaceAfterScriptDraftChange: downstream.invalidate,
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

describe('remote script draft store', () => {
  beforeEach(() => {
    documents.clear();
    downstream.invalidate.mockReset();
    downstream.sync.mockReset();
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
    await saveScriptDraft(draft('p_1', '新标题'));
    expect((await loadScriptDraft('p_1'))?.episodes[0]?.title).toBe('新标题');
    expect(documents.size).toBe(1);
  });

  it('defers invalidation but refreshes the remote workspace snapshot', async () => {
    downstream.sync.mockResolvedValue({ ok: true, revision: 1 });
    const result = await synchronizeScriptDraftDownstream({
      projectId: 'p_1',
      contentChanged: true,
      syncWhenUnchanged: true,
    });
    expect(result).toEqual({ deferred: true });
    expect(downstream.invalidate).not.toHaveBeenCalled();
    expect(downstream.sync).toHaveBeenCalledWith('p_1');
  });
});
