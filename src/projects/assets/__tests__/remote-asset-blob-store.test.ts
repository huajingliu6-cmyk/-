import { beforeEach, describe, expect, it, vi } from 'vitest';

const blobs = vi.hoisted(
  () => new Map<string, { body: Buffer; contentType: string }>(),
);

vi.mock('@/persistence/remote-data-client', () => ({
  getRemoteBlob: vi.fn(async (storageKey: string) => {
    const blob = blobs.get(storageKey);
    return blob
      ? { body: Buffer.from(blob.body), contentType: blob.contentType, etag: null }
      : null;
  }),
  putRemoteBlob: vi.fn(
    async (input: { storageKey: string; contentType: string; body: Buffer }) => {
      blobs.set(input.storageKey, {
        body: Buffer.from(input.body),
        contentType: input.contentType,
      });
    },
  ),
  deleteRemoteBlob: vi.fn(async (storageKey: string) => {
    blobs.delete(storageKey);
  }),
}));

import {
  deleteRemoteAssetAudio,
  deleteRemoteAssetImage,
  getRemoteAssetAudio,
  getRemoteAssetImage,
  putRemoteAssetAudio,
  putRemoteAssetImage,
} from '@/projects/assets/remote-asset-blob-store';

describe('remote asset blob store', () => {
  beforeEach(() => blobs.clear());

  it('round-trips image and audio bytes with project isolation', async () => {
    await putRemoteAssetImage({
      projectId: 'project_1',
      assetId: 'image_1',
      mimeType: 'image/png',
      body: Buffer.from([1, 2, 3]),
    });
    await putRemoteAssetAudio({
      projectId: 'project_1',
      assetId: 'audio_1',
      mimeType: 'audio/mpeg',
      body: Buffer.from([4, 5, 6]),
    });
    expect((await getRemoteAssetImage('project_1', 'image_1'))?.body).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect((await getRemoteAssetAudio('project_1', 'audio_1'))?.body).toEqual(
      Buffer.from([4, 5, 6]),
    );
    expect(await getRemoteAssetImage('project_2', 'image_1')).toBeNull();
  });

  it('deletes only the requested media key', async () => {
    await putRemoteAssetImage({
      projectId: 'project_1',
      assetId: 'image_1',
      mimeType: 'image/png',
      body: Buffer.from([1]),
    });
    await putRemoteAssetAudio({
      projectId: 'project_1',
      assetId: 'audio_1',
      mimeType: 'audio/mpeg',
      body: Buffer.from([2]),
    });
    await deleteRemoteAssetImage('project_1', 'image_1');
    expect(await getRemoteAssetImage('project_1', 'image_1')).toBeNull();
    expect(await getRemoteAssetAudio('project_1', 'audio_1')).not.toBeNull();
    await deleteRemoteAssetAudio('project_1', 'audio_1');
    expect(await getRemoteAssetAudio('project_1', 'audio_1')).toBeNull();
  });

  it('rejects unsafe storage identifiers', async () => {
    expect(() => getRemoteAssetImage('project_1', '../image')).toThrow(
      'INVALID_REMOTE_ASSET_IMAGE_KEY',
    );
    expect(() => getRemoteAssetAudio('project/1', 'audio_1')).toThrow(
      'INVALID_REMOTE_ASSET_AUDIO_KEY',
    );
  });
});
