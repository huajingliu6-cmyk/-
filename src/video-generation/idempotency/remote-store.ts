import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import { IdempotencyError, type IdempotencyErrorCode } from "./errors";
import type {
  GenerationIdempotencyStore,
  IdempotencyRecord,
  IdempotencyScope,
  ReserveInput,
  ReserveOutcome,
} from "./types";

const ENDPOINT = "/v1/video-generation-idempotency";

async function idempotencyRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await requestRemoteData(path, init);
  } catch {
    throw new IdempotencyError("IDEMPOTENCY_STORE_UNAVAILABLE");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { code?: IdempotencyErrorCode }
      | null;
    throw new IdempotencyError(payload?.code ?? "IDEMPOTENCY_STORE_UNAVAILABLE");
  }
  return (await response.json()) as T;
}

function command<T>(body: Record<string, unknown>): Promise<T> {
  return idempotencyRequest<T>(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export class RemoteGenerationIdempotencyStore
  implements GenerationIdempotencyStore
{
  readonly backendKind = "postgres" as const;

  async get(
    scope: IdempotencyScope,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const result = await idempotencyRequest<{ record: IdempotencyRecord | null }>(
      `${ENDPOINT}?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`,
    );
    return result.record;
  }

  reserve(input: ReserveInput): Promise<ReserveOutcome> {
    return command<ReserveOutcome>({ action: "reserve", input });
  }

  async reReserveAfterSafeFailure(input: ReserveInput): Promise<IdempotencyRecord> {
    const result = await command<{ record: IdempotencyRecord }>({
      action: "reReserveAfterSafeFailure",
      input,
    });
    return result.record;
  }

  async markSubmitting(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<IdempotencyRecord> {
    return this.transition("markSubmitting", scope, key, generationId);
  }

  async markProviderAccepted(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    providerTaskId: string,
  ): Promise<IdempotencyRecord> {
    return this.transition("markProviderAccepted", scope, key, generationId, {
      providerTaskId,
    });
  }

  async markCommitted(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<IdempotencyRecord> {
    return this.transition("markCommitted", scope, key, generationId);
  }

  async markSafeFailure(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    errorCode: string,
  ): Promise<IdempotencyRecord> {
    return this.transition("markSafeFailure", scope, key, generationId, {
      errorCode,
    });
  }

  async markUnknownOutcome(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    errorCode: string,
  ): Promise<IdempotencyRecord> {
    return this.transition("markUnknownOutcome", scope, key, generationId, {
      errorCode,
    });
  }

  async releaseIfSafe(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<boolean> {
    const result = await command<{ released: boolean }>({
      action: "releaseIfSafe",
      scope,
      key,
      generationId,
    });
    return result.released;
  }

  async listAll(): Promise<IdempotencyRecord[]> {
    const result = await idempotencyRequest<{ records: IdempotencyRecord[] }>(
      `${ENDPOINT}?list=true`,
    );
    return result.records;
  }

  private async transition(
    action: string,
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    extra: Record<string, unknown> = {},
  ): Promise<IdempotencyRecord> {
    const result = await command<{ record: IdempotencyRecord }>({
      action,
      scope,
      key,
      generationId,
      ...extra,
    });
    return result.record;
  }
}