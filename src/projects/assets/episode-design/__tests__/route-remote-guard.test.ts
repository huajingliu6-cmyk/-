import { describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  isRemoteDataServiceError: (error: unknown) =>
    error instanceof Error && error.message === 'REMOTE_DATA_UNAVAILABLE',
}));

import {
  guardEpisodeAssetDesignRemoteData,
  rejectRemoteEpisodeAssetDesignLocalDependency,
} from '@/projects/assets/episode-design/route-remote-guard';

describe('episode asset design remote route guard', () => {
  it('maps remote service failures to 503', async () => {
    const response = await guardEpisodeAssetDesignRemoteData(async () => {
      throw new Error('REMOTE_DATA_UNAVAILABLE');
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
  });

  it('rejects local-only design dependencies in remote mode', async () => {
    const response = rejectRemoteEpisodeAssetDesignLocalDependency(
      '远端事务尚未迁移',
    );
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'REMOTE_DEPENDENCY_NOT_MIGRATED',
    });
  });
});
