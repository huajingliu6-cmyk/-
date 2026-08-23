import 'server-only';

import { NextResponse } from 'next/server';
import {
  isRemoteDataOnly,
  isRemoteDataServiceError,
} from '@/persistence/remote-data-client';
import {
  isOperationFailedError,
  operationFailedResponse,
} from "@/projects/operation-failed";

export async function guardEpisodeAssetDesignRemoteData<T>(
  operation: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await operation();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: '内网数据服务不可用' }, { status: 503 });
    }
    if (isOperationFailedError(error)) {
      return operationFailedResponse();
    }
    throw error;
  }
}

export function rejectRemoteEpisodeAssetDesignLocalDependency(
  message: string,
): NextResponse | null {
  return isRemoteDataOnly()
    ? NextResponse.json(
        { error: message, code: 'REMOTE_DEPENDENCY_NOT_MIGRATED' },
        { status: 503 },
      )
    : null;
}
