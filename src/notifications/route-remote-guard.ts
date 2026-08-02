import 'server-only';

import { NextResponse } from 'next/server';
import { isRemoteDataServiceError } from '@/persistence/remote-data-client';

export async function guardNotificationRemoteData<T>(
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
