/** Backend orchestration policy — not configurable via AI task rules. */
export const ASSET_EXTRACTION_POLICY = {
  rosterChunkChars: 25_000,
  rosterConcurrency: 2,
  detailBatchSize: 5,
  detailConcurrency: 3,
  detailRetryRounds: 1,
} as const;

export type AssetExtractionPolicy = typeof ASSET_EXTRACTION_POLICY;

export function assertDetailBatchPolicy(input: {
  batchSize: number;
  concurrency: number;
}): void {
  if (input.batchSize > ASSET_EXTRACTION_POLICY.detailBatchSize) {
    throw new Error("ASSET_EXTRACTION_POLICY_BATCH_SIZE_EXCEEDED");
  }
  if (input.concurrency > ASSET_EXTRACTION_POLICY.detailConcurrency) {
    throw new Error("ASSET_EXTRACTION_POLICY_CONCURRENCY_EXCEEDED");
  }
}
