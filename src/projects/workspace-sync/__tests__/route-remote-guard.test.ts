import { describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  isRemoteDataServiceError: (error: unknown) =>
    error instanceof Error && error.message === 'REMOTE_DATA_UNAVAILABLE',
}));

import {
  guardWorkspaceRemoteData,
  rejectRemoteWorkspaceLocalDependency,
} from '@/projects/workspace-sync/route-remote-guard';

describe('workspace remote route guard', () => {
  it('maps remote data failures to 503', async () => {
    const response = await guardWorkspaceRemoteData(async () => {
      throw new Error('REMOTE_DATA_UNAVAILABLE');
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
  });

  it('rejects unmigrated local media dependencies', async () => {
    const response = rejectRemoteWorkspaceLocalDependency('媒体尚未迁移');
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'REMOTE_DEPENDENCY_NOT_MIGRATED',
    });
  });
});
