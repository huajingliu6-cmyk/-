import { mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(
  () => new Map<string, { revision: number; value: unknown }>(),
);
const state = vi.hoisted(() => ({ conflictsRemaining: 0 }));

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
    const namespace = {
      snapshot: 'workspace-snapshots',
      assets: 'workspace-assets',
      'episode-designs': 'workspace-episode-asset-designs',
    }[url.searchParams.get('kind') ?? ''];
    if (!namespace) return Response.json({ error: 'invalid kind' }, { status: 400 });
    const identity = `${namespace}/${projectId}`;
    if ((init.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init.body)) as {
        value: unknown;
        expectedRevision?: number;
      };
      const currentRevision = documents.get(identity)?.revision ?? 0;
      if (body.expectedRevision !== currentRevision) {
        return Response.json(
          { error: 'workspace data write conflict' },
          { status: 409 },
        );
      }
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const snapshot = structuredClone(documents.get(identity));
        if (state.conflictsRemaining > 0) {
          state.conflictsRemaining -= 1;
          await Promise.resolve();
          continue;
        }
        if (documents.get(identity)?.revision !== snapshot?.revision) continue;
        const revision = (snapshot?.revision ?? 0) + 1;
        documents.set(identity, { revision, value: structuredClone(body.value) });
        return Response.json({ value: body.value, revision });
      }
      return Response.json({ error: 'workspace data write conflict' }, { status: 409 });
    }
    const document = documents.get(identity);
    return Response.json({
      value: structuredClone(document?.value ?? null),
      revision: document?.revision ?? 0,
    });
  }),
}));
import { emptyEpisodeAssetDesignStore } from '@/projects/assets/episode-design/store';
import {
  loadWorkspaceLocalAssets,
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceLocalEpisodeDesignsDocument,
  loadWorkspaceSnapshot,
  saveWorkspaceLocalAssets,
  saveWorkspaceLocalEpisodeDesigns,
  saveWorkspaceSnapshot,
} from '@/projects/workspace-sync/store';

function emptyAssets(projectId: string) {
  return {
    projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
}

describe('remote workspace stores', () => {
  beforeEach(() => {
    documents.clear();
    state.conflictsRemaining = 0;
  });

  it('stores snapshot, local assets and local designs separately', async () => {
    const projectId = 'project_1';
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'workspace-remote-'));
    process.env.APP_DATA_DIR = isolatedRoot;
    process.env.DATA_ROOT = isolatedRoot;

    await saveWorkspaceSnapshot({
      projectId,
      upstreamRevision: 1,
      syncedAt: '2026-08-01T00:00:00.000Z',
      sourceFingerprint: 'fingerprint',
      episodes: [
        { id: 'episode_1', episodeNumber: 1, title: '第一集', content: '正文' },
      ],
      assets: emptyAssets(projectId),
      episodeAssetDesigns: emptyEpisodeAssetDesignStore(projectId),
      syncStatus: 'ok',
      syncError: null,
    });
    await saveWorkspaceLocalAssets({
      ...emptyAssets(projectId),
      characters: [
        {
          id: 'character_1',
          projectId,
          name: '林清',
          role: '主角',
          description: '',
          appearance: '',
          clothing: '',
          age: '',
          gender: '',
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: 'draft',
        },
      ],
    });
    await saveWorkspaceLocalEpisodeDesigns(
      emptyEpisodeAssetDesignStore(projectId),
    );

    expect((await loadWorkspaceSnapshot(projectId))?.episodes[0]?.title).toBe(
      '第一集',
    );
    expect((await loadWorkspaceLocalAssets(projectId))?.characters[0]?.name).toBe(
      '林清',
    );
    expect((await loadWorkspaceLocalEpisodeDesigns(projectId)).records).toEqual(
      [],
    );
    expect(documents.get(`workspace-snapshots/${projectId}`)?.revision).toBe(1);
    expect(documents.get(`workspace-assets/${projectId}`)?.revision).toBe(1);
    expect(
      documents.get(`workspace-episode-asset-designs/${projectId}`)?.revision,
    ).toBe(1);
    expect(await readdir(isolatedRoot)).toEqual([]);
  });

  it('isolates workspace documents by project', async () => {
    await saveWorkspaceLocalAssets(emptyAssets('project_1'));
    await saveWorkspaceLocalAssets(emptyAssets('project_2'));
    expect((await loadWorkspaceLocalAssets('project_1'))?.projectId).toBe(
      'project_1',
    );
    expect((await loadWorkspaceLocalAssets('project_2'))?.projectId).toBe(
      'project_2',
    );
  });

  it('returns missing workspace values without creating documents', async () => {
    expect(await loadWorkspaceSnapshot('missing')).toBeNull();
    expect(await loadWorkspaceLocalAssets('missing')).toBeNull();
    expect((await loadWorkspaceLocalEpisodeDesigns('missing')).records).toEqual(
      [],
    );
    expect(documents.size).toBe(0);
  });

  it('retries outer document revision conflicts', async () => {
    state.conflictsRemaining = 2;
    await saveWorkspaceLocalAssets(emptyAssets('project_1'));
    expect(documents.get('workspace-assets/project_1')?.revision).toBe(1);
  });

  it('rejects an episode-design write carrying a stale remote revision', async () => {
    const projectId = 'project_1';
    await saveWorkspaceLocalEpisodeDesigns(
      emptyEpisodeAssetDesignStore(projectId),
    );
    const stale = await loadWorkspaceLocalEpisodeDesignsDocument(projectId);

    await saveWorkspaceLocalEpisodeDesigns(
      {
        ...stale.value,
        records: [
          {
            episodeId: 'ep1',
            episodeNumber: 1,
            status: 'draft',
            revision: 1,
            contentFingerprint: 'fp',
            generationId: null,
            items: [],
            confirmedAt: null,
            confirmedBy: null,
            confirmedRevision: null,
            updatedAt: '2026-08-12T01:00:00.000Z',
          },
        ],
        updatedAt: '2026-08-12T01:00:00.000Z',
      },
      { expectedRemoteRevision: stale.remoteRevision ?? 0 },
    );

    await expect(
      saveWorkspaceLocalEpisodeDesigns(
        {
          ...stale.value,
          records: [
            {
              episodeId: 'ep_stale',
              episodeNumber: 9,
              status: 'draft',
              revision: 1,
              contentFingerprint: 'stale',
              generationId: null,
              items: [],
              confirmedAt: null,
              confirmedBy: null,
              confirmedRevision: null,
              updatedAt: '2026-08-12T00:00:00.000Z',
            },
          ],
        },
        {
          expectedRemoteRevision: stale.remoteRevision ?? undefined,
        },
      ),
    ).rejects.toThrow(/REVISION_CONFLICT|REMOTE_WORKSPACE_REQUEST_FAILED:409/);
    expect(
      documents.get('workspace-episode-asset-designs/project_1')?.revision,
    ).toBe(2);
  });
});
