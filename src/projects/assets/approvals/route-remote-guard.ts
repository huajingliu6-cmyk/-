import 'server-only';

import { NextResponse } from 'next/server';
import {
  isRemoteDataOnly,
  isRemoteDataServiceError,
} from '@/persistence/remote-data-client';

export async function guardAssetApprovalRemoteData<T>(
  operation: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await operation();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: '内网数据服务不可用' }, { status: 503 });
    }
    throw error;
  }
}

export function rejectRemoteAssetApprovalMutation(message: string) {
  return isRemoteDataOnly()
    ? NextResponse.json(
        { error: message, code: 'REMOTE_DEPENDENCY_NOT_MIGRATED' },
        { status: 503 },
      )
    : null;
}
