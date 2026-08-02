/**
 * 持久化幂等记录类型。
 * 不含 prompt 全文、素材二进制、base64、API Key、签名 URL。
 */

export type IdempotencyScope = "video-generation";

export type IdempotencyState =
  | "reserved"
  | "submitting"
  | "providerAccepted"
  | "committed"
  | "safeFailure"
  | "unknownOutcome";

export type IdempotencyRecord = {
  id: string;
  scope: IdempotencyScope;
  idempotencyKey: string;
  requestFingerprint: string;
  generationId: string;
  projectId: string;
  shotNodeId: string;
  providerId: string;
  state: IdempotencyState;
  providerTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastErrorCode: string | null;
};

export type ReserveInput = {
  scope: IdempotencyScope;
  idempotencyKey: string;
  requestFingerprint: string;
  generationId: string;
  projectId: string;
  shotNodeId: string;
  providerId: string;
  /** 记录保留期（毫秒），缺省由 store 决定 */
  ttlMs?: number;
};

export type ReserveOutcome =
  | { kind: "reserved"; record: IdempotencyRecord }
  | { kind: "existing"; record: IdempotencyRecord }
  | { kind: "in_progress"; record: IdempotencyRecord }
  | { kind: "safe_retry"; record: IdempotencyRecord }
  | { kind: "blocked_unknown"; record: IdempotencyRecord };

export type GenerationIdempotencyStore = {
  /**
   * 本地文件实现仅声明支持「单机器共享文件系统」。
   * 多实例 / 多机器必须换 Postgres 或 Redis 实现同一接口。
   */
  readonly backendKind: "file-local" | "postgres" | "redis";

  reserve(input: ReserveInput): Promise<ReserveOutcome>;
  reReserveAfterSafeFailure(input: ReserveInput): Promise<IdempotencyRecord>;
  get(
    scope: IdempotencyScope,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  markSubmitting(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<IdempotencyRecord>;
  markProviderAccepted(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    providerTaskId: string,
  ): Promise<IdempotencyRecord>;
  markCommitted(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<IdempotencyRecord>;
  markSafeFailure(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    errorCode: string,
  ): Promise<IdempotencyRecord>;
  markUnknownOutcome(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
    errorCode: string,
  ): Promise<IdempotencyRecord>;
  /**
   * 仅在明确未调用 Provider（safeFailure / 未 submitting）时可释放，
   * 以便同 key 重新 reserve。已 providerAccepted / unknownOutcome / committed 不可释放。
   */
  releaseIfSafe(
    scope: IdempotencyScope,
    key: string,
    generationId: string,
  ): Promise<boolean>;
  listAll(): Promise<IdempotencyRecord[]>;
};
