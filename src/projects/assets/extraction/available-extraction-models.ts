import {
  ASSET_ROSTER_EXTRACT_CAPABILITY,
  ASSET_DETAIL_EXTRACT_CAPABILITY,
} from "@/projects/assets/extraction/extraction-capabilities";
import {
  ASSET_EXTRACTION_MODEL_OPTIONS,
  defaultAssetExtractionModelKey,
} from "@/projects/assets/extraction/models";

export type CapabilityAvailabilityRow = {
  capabilityId: string;
  available: boolean;
  label?: string;
  reasonCode?: string | null;
};

export type AvailableAssetExtractionModels = {
  ready: boolean;
  reason: string | null;
  models: Array<{ id: string; label: string }>;
  defaultModelId: string;
};

const REQUIRED_CAPABILITIES = [
  ASSET_ROSTER_EXTRACT_CAPABILITY,
  ASSET_DETAIL_EXTRACT_CAPABILITY,
] as const;

export function resolveAvailableAssetExtractionModels(
  capabilities: CapabilityAvailabilityRow[],
): AvailableAssetExtractionModels {
  const byId = new Map(
    capabilities.map((row) => [row.capabilityId, row] as const),
  );
  const missing = REQUIRED_CAPABILITIES.filter(
    (id) => !byId.get(id)?.available,
  );
  if (missing.length > 0) {
    const labels = missing
      .map((id) => byId.get(id)?.label?.trim() || id)
      .join("、");
    return {
      ready: false,
      reason: `资产提取模型未配置或不可用（${labels}）。请联系管理员配置后再试。`,
      models: [],
      defaultModelId: defaultAssetExtractionModelKey(),
    };
  }
  return {
    ready: true,
    reason: null,
    models: ASSET_EXTRACTION_MODEL_OPTIONS.map((model) => ({
      id: model.id,
      label: model.label,
    })),
    defaultModelId: defaultAssetExtractionModelKey(),
  };
}

export async function fetchAvailableAssetExtractionModels(): Promise<AvailableAssetExtractionModels> {
  const res = await fetch("/api/ai-capabilities/availability", {
    credentials: "include",
  });
  if (!res.ok) {
    return {
      ready: false,
      reason: "无法加载资产提取模型配置，请稍后重试。",
      models: [],
      defaultModelId: defaultAssetExtractionModelKey(),
    };
  }
  const payload = (await res.json()) as {
    capabilities?: CapabilityAvailabilityRow[];
  };
  return resolveAvailableAssetExtractionModels(payload.capabilities ?? []);
}
