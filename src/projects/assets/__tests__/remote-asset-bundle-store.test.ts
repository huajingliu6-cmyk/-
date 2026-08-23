import { mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);
const state = vi.hoisted(() => ({ conflictsRemaining: 0 }));
const downstream = vi.hoisted(() => ({ voice: vi.fn(), workspace: vi.fn() }));

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  isRemoteRevisionConflict: (error: unknown) =>
    error instanceof Error && error.message === 'REVISION_CONFLICT',
  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
    const identity = `${namespace}/${key}`;
    const doc = documents.get(identity);
    if (!doc) return null;
    return {
      namespace,
      key,
      revision: doc.revision,
      value: structuredClone(doc.value),
      updatedAt: new Date().toISOString(),
    };
  }),
  putRemoteDocument: vi.fn(
    async (input: {
      namespace: string;
      key: string;
      expectedRevision?: number;
      value: unknown;
    }) => {
      const identity = `${input.namespace}/${input.key}`;
      const current = documents.get(identity);
      const expected = input.expectedRevision ?? 0;
      if ((current?.revision ?? 0) !== expected) {
        throw new Error('REVISION_CONFLICT');
      }
      const revision = (current?.revision ?? 0) + 1;
      documents.set(identity, {
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
    if (state.conflictsRemaining > 0) {
      state.conflictsRemaining -= 1;
      throw new Error('REVISION_CONFLICT');
    }
    const results = [];
    for (const write of input.writes) {
      const identity = `${write.namespace}/${write.key}`;
      const current = documents.get(identity);
      if ((current?.revision ?? 0) !== write.expectedRevision) {
        throw new Error('REVISION_CONFLICT');
      }
    }
    for (const write of input.writes) {
      const identity = `${write.namespace}/${write.key}`;
      const current = documents.get(identity);
      const revision = (current?.revision ?? 0) + 1;
      documents.set(identity, {
        revision,
        value: structuredClone(write.value),
      });
      results.push({
        namespace: write.namespace,
        key: write.key,
        revision,
        value: structuredClone(write.value),
        updatedAt: new Date().toISOString(),
      });
    }
    return { documents: results };
  }),
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, 'http://go-backend.internal');
    const projectId = url.searchParams.get('projectId') ?? '';
    const identity = 'asset-bundles/' + projectId;
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init.body)) as { value: Record<string, unknown> };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const snapshot = structuredClone(documents.get(identity));
        if (state.conflictsRemaining > 0) {
          state.conflictsRemaining -= 1;
          await Promise.resolve();
          continue;
        }
        if (documents.get(identity)?.revision !== snapshot?.revision) continue;
        const value = {
          ...body.value,
          updatedAt: new Date().toISOString(),
        };
        const revision = (snapshot?.revision ?? 0) + 1;
        documents.set(identity, { revision, value: structuredClone(value) });
        return Response.json({ value, revision });
      }
      return Response.json({ error: 'project asset data write conflict' }, { status: 409 });
    }
    const document = documents.get(identity);
    return Response.json({
      value: structuredClone(document?.value ?? null),
      revision: document?.revision ?? 0,
    });
  }),
}));

vi.mock('@/projects/assets/sync-character-voice', () => ({
  syncChangedCharacterVoicesFromBundle: downstream.voice,
}));
vi.mock('@/projects/workspace-sync/sync-management-to-workspace', () => ({
  syncManagementToWorkspace: downstream.workspace,
}));

import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from '@/projects/assets/asset-bundle-store';
import { synchronizeAssetDraftDownstream } from '@/projects/assets/asset-draft-downstream';

function bundle(projectId: string, name: string) {
  return {
    projectId,
    characters: [
      {
        id: 'character_1',
        projectId,
        name,
        role: '主角',
        description: '',
        appearance: '',
        clothing: '',
        age: '',
        gender: '',
        voiceId: null,
        voiceName: null,
        voiceStyle: null,
        imageFileName: 'hero.png',
        imageObjectUrl: 'blob:http://local/hero',
        imageMimeType: 'image/png',
        status: 'draft' as const,
      },
    ],
    scenes: [],
    props: [],
    audios: [
      {
        id: 'audio_1',
        projectId,
        name: '旁白',
        type: 'voice' as const,
        duration: '',
        source: '',
        fileName: 'voice.mp3',
        objectUrl: 'blob:http://local/audio',
        mimeType: 'audio/mpeg',
        status: 'draft' as const,
      },
    ],
  };
}

describe('remote asset bundle store', () => {
  beforeEach(() => {
    documents.clear();
    state.conflictsRemaining = 0;
    downstream.voice.mockReset();
    downstream.workspace.mockReset();
  });

  it('sanitizes and persists metadata without local files', async () => {
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'asset-remote-'));
    process.env.APP_DATA_DIR = isolatedRoot;
    process.env.DATA_ROOT = isolatedRoot;

    const saved = await saveAssetBundleDraft(bundle('project_1', '林清'));
    expect(saved.characters[0]?.imageObjectUrl).toBeNull();
    expect(saved.audios[0]?.objectUrl).toBeNull();
    expect((await loadAssetBundleDraft('project_1'))?.characters[0]?.name).toBe(
      '林清',
    );
    expect(await readdir(isolatedRoot)).toEqual([]);
  });

  it('isolates character, scene, prop and audio metadata by project', async () => {
    await saveAssetBundleDraft(bundle('project_1', '一号角色'));
    await saveAssetBundleDraft(bundle('project_2', '二号角色'));
    expect((await loadAssetBundleDraft('project_1'))?.characters[0]?.name).toBe(
      '一号角色',
    );
    expect((await loadAssetBundleDraft('project_2'))?.characters[0]?.name).toBe(
      '二号角色',
    );
    expect(documents.get('asset-bundles/project_1')?.revision).toBe(1);
    expect(documents.get('asset-bundles/project_2')?.revision).toBe(1);
  });

  it('retries revision conflicts', async () => {
    state.conflictsRemaining = 2;
    const saved = await saveAssetBundleDraft(bundle('project_1', '重试成功'));
    expect(saved.characters[0]?.name).toBe('重试成功');
    expect(documents.get('asset-bundles/project_1')?.revision).toBe(1);
  });

  it('syncs character voices and refreshes the remote workspace snapshot', async () => {
    downstream.workspace.mockResolvedValue({ ok: true, revision: 1 });
    const next = await saveAssetBundleDraft(bundle('project_1', '林清'));
    const result = await synchronizeAssetDraftDownstream({
      projectId: 'project_1',
      previous: null,
      next,
    });
    expect(result).toEqual({ deferred: true });
    expect(downstream.voice).toHaveBeenCalledWith({
      projectId: 'project_1',
      previous: null,
      next,
    });
    expect(downstream.workspace).toHaveBeenCalledWith('project_1');
  });
});
