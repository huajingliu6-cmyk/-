import { ASSET_EXTRACTION_POLICY } from "@/projects/assets/extraction/asset-extraction-policy";

export const ASSET_DETAIL_BATCH_SIZE = ASSET_EXTRACTION_POLICY.detailBatchSize;
export const ASSET_DETAIL_CONCURRENCY = ASSET_EXTRACTION_POLICY.detailConcurrency;
export const ASSET_DETAIL_AUTO_RETRY_ROUNDS =
  ASSET_EXTRACTION_POLICY.detailRetryRounds;

export const ROSTER_PROGRESS_MAX = 15;
export const DETAIL_PROGRESS_SPAN = 75;
export const RETRY_PROGRESS_MIN = 90;
export const RETRY_PROGRESS_MAX = 99;
