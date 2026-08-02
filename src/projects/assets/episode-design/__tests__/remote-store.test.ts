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
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, 'http://go-backend.internal');
    const projectId = url.searchParams.get('projectId') ?? '';
    const identity = 'episode-asset-designs/' + projectId;
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
          ...('episode-designs' === 'approvals' ? { version: 1 } : {}),
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
import {
  emptyEpisodeAssetDesignStore,
  getOrCreateEpisodeRecord,
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
} from '@/projects/assets/episode-design/store';

function designStore(projectId: string, episodeId: string) {
  const base = emptyEpisodeAssetDesignStore(projectId);
  const { record } = getOrCreateEpisodeRecord(base, episodeId, 1);
  return {
    ...base,
    records: [
      {
        ...record,
        status: 'review' as const,
        revision: 1,
        items: [
          {
            id: `${episodeId}_character_1`,
            assetType: 'character' as const,
            name: '林清',
            source: 'ai' as const,
            resolution: 'pending' as const,
            existingAssetId: null,
            libraryAssetId: null,
            draft: {
              description: '主角',
              appearance: '',
              clothing: '',
              role: '主角',
              age: '',
              voiceId: null,
              voiceName: null,
              voiceBound: false,
              usageInEpisode: '',
              evidence: '',
            },
          },
        ],
      },
    ],
  };
}

describe('remote episode asset design store', () => {
  beforeEach(() => {
    documents.clear();
    state.conflictsRemaining = 0;
  });

  it('persists normalized design records without local files', async () => {
    const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'design-remote-'));
    process.env.APP_DATA_DIR = isolatedRoot;
    process.env.DATA_ROOT = isolatedRoot;

    await saveEpisodeAssetDesignStore(designStore('project_1', 'episode_1'));
    const loaded = await loadEpisodeAssetDesignStore('project_1');
    expect(loaded.records[0]?.episodeId).toBe('episode_1');
    expect(loaded.records[0]?.items[0]?.name).toBe('林清');
    expect(await readdir(isolatedRoot)).toEqual([]);
  });

  it('isolates design documents by project', async () => {
    await saveEpisodeAssetDesignStore(designStore('project_1', 'episode_1'));
    await saveEpisodeAssetDesignStore(designStore('project_2', 'episode_2'));
    expect((await loadEpisodeAssetDesignStore('project_1')).records[0]?.episodeId).toBe(
      'episode_1',
    );
    expect((await loadEpisodeAssetDesignStore('project_2')).records[0]?.episodeId).toBe(
      'episode_2',
    );
    expect(documents.size).toBe(2);
  });

  it('returns an empty remote store when the document is missing', async () => {
    const loaded = await loadEpisodeAssetDesignStore('project_missing');
    expect(loaded).toMatchObject({ projectId: 'project_missing', records: [] });
  });

  it('retries outer document revision conflicts', async () => {
    state.conflictsRemaining = 2;
    const saved = await saveEpisodeAssetDesignStore(
      designStore('project_1', 'episode_1'),
    );
    expect(saved.records[0]?.revision).toBe(1);
    expect(documents.get('episode-asset-designs/project_1')?.revision).toBe(1);
  });
});
