import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { putRemoteDocumentsAtomic } from '@/persistence/remote-data-client';

describe('remote document transaction client', () => {
  beforeEach(() => {
    process.env.GO_BACKEND_INTERNAL_URL = 'http://internal-api.test';
    process.env.INTERNAL_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends document writes and blob copies in one request', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ documents: [] }, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await putRemoteDocumentsAtomic({
      writes: [
        {
          namespace: 'asset-approvals',
          key: 'project_1',
          expectedRevision: 1,
          value: { version: 1 },
        },
        {
          namespace: 'asset-bundles',
          key: 'project_1',
          expectedRevision: 2,
          value: { projectId: 'project_1' },
        },
      ],
      blobCopies: [
        {
          sourceStorageKey: 'projects/project_1/asset-images/media_1',
          targetStorageKey: 'projects/project_1/asset-images/asset_1',
        },
      ],
      blobChecks: ['projects/project_1/asset-images/media_1'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://internal-api.test/v1/document-transactions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      writes: expect.any(Array),
      blobCopies: [
        {
          sourceStorageKey: 'projects/project_1/asset-images/media_1',
          targetStorageKey: 'projects/project_1/asset-images/asset_1',
        },
      ],
      blobChecks: ['projects/project_1/asset-images/media_1'],
    });
  });

  it('maps revision conflicts to the shared conflict error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'conflict' }, { status: 409 })),
    );

    await expect(
      putRemoteDocumentsAtomic({
        writes: [
          { namespace: 'a', key: '1', expectedRevision: 1, value: {} },
          { namespace: 'b', key: '1', expectedRevision: 1, value: {} },
        ],
      }),
    ).rejects.toThrow('REVISION_CONFLICT');
  });

  it('maps a missing source blob to a stable media error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'missing' }, { status: 422 })),
    );

    await expect(
      putRemoteDocumentsAtomic({
        writes: [
          { namespace: 'a', key: '1', expectedRevision: 1, value: {} },
          { namespace: 'b', key: '1', expectedRevision: 1, value: {} },
        ],
        blobCopies: [
          { sourceStorageKey: 'missing', targetStorageKey: 'target' },
        ],
      }),
    ).rejects.toThrow('REMOTE_BLOB_SOURCE_NOT_FOUND');
  });
});
