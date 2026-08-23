import { NextResponse } from "next/server";

export const OPERATION_FAILED = "OPERATION_FAILED";
export const OPERATION_FAILED_MESSAGE = "操作未完成，请重新操作";

export class OperationFailedError extends Error {
  readonly code = OPERATION_FAILED;

  constructor(cause?: unknown) {
    super(OPERATION_FAILED_MESSAGE);
    this.name = "OperationFailedError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export function isOperationFailedError(
  error: unknown,
): error is OperationFailedError {
  return (
    error instanceof OperationFailedError ||
    (error instanceof Error &&
      ((error as { code?: string }).code === OPERATION_FAILED ||
        error.message === OPERATION_FAILED_MESSAGE))
  );
}

export function operationFailedBody() {
  return { code: OPERATION_FAILED, error: OPERATION_FAILED_MESSAGE };
}

export function operationFailedResponse(status = 503): NextResponse {
  return NextResponse.json(operationFailedBody(), { status });
}

export function wrapWriteFailure(error: unknown): never {
  if (isRevisionConflictError(error)) throw error;
  if (isOperationFailedError(error)) throw error;
  throw new OperationFailedError(error);
}

export function isRevisionConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "REVISION_CONFLICT" ||
    error.message === "ASSET_REVISION_CONFLICT" ||
    error.message === "PRODUCTION_REVISION_CONFLICT" ||
    error.message.startsWith("REMOTE_PROJECT_ASSET_DATA_CONFLICT")
  );
}
