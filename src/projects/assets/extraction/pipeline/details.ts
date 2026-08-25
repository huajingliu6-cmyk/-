import { recoverJsonObjectText } from "@/projects/assets/episode-design/json-text-repair";
import {
  extractRawAssetList,
  normalizeRawAsset,
} from "@/projects/assets/episode-design/normalize-raw-asset";
import type { EpisodeAssetDesignGenerationDto } from "@/projects/assets/episode-design/schema";
import { dtoToExtractedAssets } from "@/projects/assets/extraction/from-dto";
import { assetIdentity } from "@/projects/assets/extraction/identity";
import {
  ASSET_DETAIL_BATCH_SIZE,
  ASSET_DETAIL_CONCURRENCY,
} from "@/projects/assets/extraction/pipeline/constants";
import { ASSET_EXTRACTION_POLICY } from "@/projects/assets/extraction/asset-extraction-policy";
import { assertDetailBatchPolicy } from "@/projects/assets/extraction/asset-extraction-policy";
import { collectProviderText, mapPool } from "@/projects/assets/extraction/pipeline/pool";
import { batchItems } from "@/projects/assets/extraction/pipeline/progress";
import {
  buildDetailEvidence,
  buildDetailUserPrompt,
} from "@/projects/assets/extraction/pipeline/prompts";
import type {
  AssetDetailTaskItem,
  AssetRosterItem,
  ExtractedAsset,
} from "@/projects/assets/extraction/types";
import type { TextGenerationProvider } from "@/text-generation/provider/types";

export type DetailBatchOutcome = {
  assetKey: string;
  name: string;
  ok: boolean;
  asset?: ExtractedAsset;
  errorCode?: string;
  errorMessage?: string;
  batchIndex: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rawAssetKey(
  raw: unknown,
  fallbackType?: string,
  fallbackName?: string,
): string {
  const obj = asRecord(raw);
  if (!obj) return "";
  const explicit =
    (typeof obj.assetKey === "string" && obj.assetKey.trim()) ||
    (typeof obj.asset_key === "string" && obj.asset_key.trim()) ||
    "";
  if (explicit) return explicit;
  const type =
    typeof obj.type === "string"
      ? obj.type
      : typeof fallbackType === "string"
        ? fallbackType
        : "";
  const name =
    typeof obj.name === "string"
      ? obj.name
      : typeof fallbackName === "string"
        ? fallbackName
        : "";
  if (
    (type === "character" ||
      type === "scene" ||
      type === "prop" ||
      type === "audio") &&
    name.trim()
  ) {
    return assetIdentity(type, name);
  }
  return "";
}

export function parseDetailBatchOutput(input: {
  text: string;
  batch: AssetRosterItem[];
  batchIndex: number;
}): DetailBatchOutcome[] {
  const batchIndex = input.batchIndex;
  const fail = (
    item: AssetRosterItem,
    errorCode: string,
    errorMessage: string,
  ): DetailBatchOutcome => ({
    assetKey: item.assetKey,
    name: item.name,
    ok: false,
    errorCode,
    errorMessage,
    batchIndex,
  });
  const byKey = new Map(input.batch.map((item) => [item.assetKey, item]));
  const recovered = recoverJsonObjectText(input.text);
  if (!recovered) {
    return input.batch.map((item) =>
      fail(item, "EPISODE_ASSET_DESIGN_OUTPUT_INVALID", "本批 JSON 无效"),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(recovered.text) as unknown;
  } catch {
    return input.batch.map((item) =>
      fail(item, "EPISODE_ASSET_DESIGN_OUTPUT_INVALID", "本批 JSON 无效"),
    );
  }
  const list = extractRawAssetList(parsed);
  if (!list) {
    return input.batch.map((item) =>
      fail(item, "EPISODE_ASSET_DESIGN_OUTPUT_INVALID", "缺少资产列表"),
    );
  }

  const seen = new Set<string>();
  const outcomes: DetailBatchOutcome[] = [];
  for (const raw of list) {
    const obj = asRecord(raw);
    const explicitKey =
      (typeof obj?.assetKey === "string" && obj.assetKey.trim()) ||
      (typeof obj?.asset_key === "string" && obj.asset_key.trim()) ||
      "";
    if (explicitKey && !byKey.has(explicitKey)) {
      continue;
    }
    const key = rawAssetKey(raw);
    const roster = key ? byKey.get(key) : undefined;
    const matched =
      roster ??
      input.batch.find((item) => {
        const name = typeof obj?.name === "string" ? obj.name : "";
        return (
          name &&
          assetIdentity(item.type, name) === item.assetKey &&
          !seen.has(item.assetKey)
        );
      });
    if (!matched || seen.has(matched.assetKey)) continue;
    seen.add(matched.assetKey);
    if (explicitKey && explicitKey !== matched.assetKey) {
      outcomes.push(
        fail(matched, "ASSET_KEY_MISMATCH", "返回项与 assetKey 不匹配"),
      );
      continue;
    }
    const normalized = normalizeRawAsset(raw, outcomes.length);
    if (!normalized.ok) {
      outcomes.push(
        fail(matched, normalized.rejected.code, normalized.rejected.reason),
      );
      continue;
    }
    const dto: EpisodeAssetDesignGenerationDto = {
      version: 1,
      assets: [normalized.value],
    };
    const [extracted] = dtoToExtractedAssets(dto, null);
    if (!extracted) {
      outcomes.push(fail(matched, "ASSET_DETAIL_INVALID", "字段校验失败"));
      continue;
    }
    outcomes.push({
      assetKey: matched.assetKey,
      name: matched.name,
      ok: true,
      batchIndex,
      asset: {
        ...extracted,
        identity: matched.assetKey,
        name: matched.name,
        assetType: matched.type,
        sourceEpisodeIds: [...matched.episodeIds],
        firstSeenOrder: matched.firstSeenOrder,
      },
    });
  }

  for (const item of input.batch) {
    if (seen.has(item.assetKey)) continue;
    outcomes.push(fail(item, "ASSET_DETAIL_MISSING", "模型未返回该资产"));
  }
  return outcomes;
}

export async function runAssetDetailBatches(input: {
  items: AssetRosterItem[];
  provider: TextGenerationProvider;
  systemPrompt: string;
  providerModelId: string;
  episodes: Array<{
    id: string;
    episodeNumber: number;
    title: string;
    content: string;
  }>;
  maxOutputTokens?: number;
  concurrency?: number;
  batchSize?: number;
  onBatchStart?: (info: {
    batchIndex: number;
    batchSize: number;
    totalBatches: number;
    runningBatchIndexes: number[];
  }) => Promise<void> | void;
  onBatchSettled?: (outcomes: DetailBatchOutcome[]) => Promise<void> | void;
  onHeartbeat?: () => Promise<void> | void;
}): Promise<DetailBatchOutcome[]> {
  const batchSize = input.batchSize ?? ASSET_DETAIL_BATCH_SIZE;
  const concurrency = input.concurrency ?? ASSET_DETAIL_CONCURRENCY;
  assertDetailBatchPolicy({ batchSize, concurrency });
  const batches = batchItems(input.items, batchSize);
  const all: DetailBatchOutcome[] = [];
  const running = new Set<number>();
  const batchOutcomes = await mapPool(
    batches,
    concurrency,
    async (batch, index) => {
      const batchIndex = index + 1;
      running.add(batchIndex);
      await input.onBatchStart?.({
        batchIndex,
        batchSize: batch.length,
        totalBatches: batches.length,
        runningBatchIndexes: [...running],
      });
      try {
        const collected = await collectProviderText({
          provider: input.provider,
          systemPrompt: input.systemPrompt,
          userPrompt: buildDetailUserPrompt({
            batch,
            evidence: buildDetailEvidence({
              batch,
              episodes: input.episodes,
            }),
          }),
          providerModelId: input.providerModelId,
          maxOutputTokens: input.maxOutputTokens ?? 8_000,
          timeoutMs: ASSET_EXTRACTION_POLICY.detailBatchTimeoutMs,
          tickMs: ASSET_EXTRACTION_POLICY.runnerHeartbeatMs,
          onTick: input.onHeartbeat,
        });
        const outcomes = collected.ok
          ? parseDetailBatchOutput({ text: collected.text, batch, batchIndex })
          : batch.map((item) => ({
              assetKey: item.assetKey,
              name: item.name,
              ok: false,
              batchIndex,
              errorCode: collected.code,
              errorMessage: collected.message,
            }));
        await input.onBatchSettled?.(outcomes);
        return outcomes;
      } finally {
        running.delete(batchIndex);
      }
    },
  );
  for (const outcomes of batchOutcomes) {
    all.push(...outcomes);
  }
  return all;
}

export function detailItemsFromRoster(
  roster: AssetRosterItem[],
  previous: AssetDetailTaskItem[] = [],
): AssetDetailTaskItem[] {
  const prevByKey = new Map(previous.map((item) => [item.assetKey, item]));
  return roster.map((item) => {
    const prev = prevByKey.get(item.assetKey);
    if (prev) {
      return {
        ...prev,
        name: item.name,
        status: prev.status === "running" ? "pending" : prev.status,
      };
    }
    return {
      assetKey: item.assetKey,
      name: item.name,
      status: "pending",
      attempt: 0,
    };
  });
}
