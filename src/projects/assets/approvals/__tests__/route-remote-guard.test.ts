import { describe, expect, it, vi } from 'vitest';

vi.mock('@/persistence/remote-data-client', () => ({
  isRemoteDataOnly: () => true,
  isRemoteDataServiceError: (error: unknown) =>
    error instanceof Error && error.message === 'REMOTE_DATA_UNAVAILABLE',
}));

vi.mock('server-only', () => ({}));

import {
  guardAssetApprovalRemoteData,
  rejectRemoteAssetApprovalMutation,
} from '@/projects/assets/approvals/route-remote-guard';
import {
  OperationFailedError,
  OPERATION_FAILED,
} from '@/projects/operation-failed';

describe('asset approval remote route guard', () => {
  it('maps remote service failures to 503', async () => {
    const response = await guardAssetApprovalRemoteData(async () => {
      throw new Error('REMOTE_DATA_UNAVAILABLE');
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
  });

  it('maps OPERATION_FAILED to a retryable response and never 500', async () => {
    const response = await guardAssetApprovalRemoteData(async () => {
      throw new OperationFailedError();
    });
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
    await expect((response as Response).json()).resolves.toMatchObject({
      code: OPERATION_FAILED,
      error: '操作未完成，请重新操作',
    });
  });

  it('rejects approval mutations with unmigrated dependencies', async () => {
    const response = rejectRemoteAssetApprovalMutation('远端事务尚未迁移');
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'REMOTE_DEPENDENCY_NOT_MIGRATED',
    });
  });
});
