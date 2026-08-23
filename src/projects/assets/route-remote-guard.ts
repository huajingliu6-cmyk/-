import { NextResponse } from "next/server";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import {
  ASSET_REVISION_CONFLICT,
  ASSET_REVISION_REQUIRED,
  isAssetRevisionError,
} from "@/projects/assets/asset-bundle-revision";
import {
  isOperationFailedError,
  isRevisionConflictError,
  operationFailedResponse,
} from "@/projects/operation-failed";

export async function guardAssetRemoteData<T>(
  operation: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    return await operation();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    if (isAssetRevisionError(error)) {
      return NextResponse.json(
        {
          error: "资产数据已变更，请刷新后重试",
          code:
            error instanceof Error && error.message === ASSET_REVISION_CONFLICT
              ? ASSET_REVISION_CONFLICT
              : ASSET_REVISION_REQUIRED,
        },
        { status: 409 },
      );
    }
    if (isRevisionConflictError(error)) throw error;
    if (isOperationFailedError(error)) {
      return operationFailedResponse();
    }
    throw error;
  }
}
