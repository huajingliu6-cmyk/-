import { describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  isRemoteDataServiceError: (error: unknown) =>
    error instanceof Error && error.message === 'REMOTE_DATA_UNAVAILABLE',
}));

import {
  guardAssetApprovalRemoteData,
  rejectRemoteAssetApprovalMutation,
} from '@/projects/assets/approvals/route-remote-guard';

describe('asset approval remote route guard', () => {
  it('maps remote service failures to 503', async () => {
    const response = await guardAssetApprovalRemoteData(async () => {
      throw new Error('REMOTE_DATA_UNAVAILABLE');
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
  });

  it('rejects approval mutations with unmigrated dependencies', async () => {
    const response = rejectRemoteAssetApprovalMutation('远端事务尚未迁移');
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'REMOTE_DEPENDENCY_NOT_MIGRATED',
    });
  });
});
