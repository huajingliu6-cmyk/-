import type {
  AssetDesignPromptHistoryEntry,
  EpisodeAssetDesignItem,
} from "@/projects/assets/episode-design/types";
import {
  designPromptContentFingerprint,
  resolveFormalDesignPromptText,
} from "@/projects/assets/episode-design/format-design-draft-seed";
import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";

export function designPromptAutoGenKey(
  item: EpisodeAssetDesignItem,
  promptModelId: DesignPromptModelId = DEFAULT_DESIGN_PROMPT_MODEL_ID,
): string {
  return `${item.id}|${designPromptContentFingerprint(item)}|${promptModelId}`;
}

export function itemNeedsFormalDesignPrompt(
  item: EpisodeAssetDesignItem,
): boolean {
  return !resolveFormalDesignPromptText(item);
}

export function buildItemGeneratePromptUrl(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  itemId: string;
}): string {
  const enc = encodeURIComponent;
  if (input.surface === "workspace") {
    return `/api/workspace/projects/${enc(input.projectId)}/asset-designs/episodes/${enc(input.episodeId)}/items/${enc(input.itemId)}/generate-prompt`;
  }
  return `/api/projects/${enc(input.projectId)}/asset-designs/episodes/${enc(input.episodeId)}/items/${enc(input.itemId)}/generate-prompt`;
}

export type GenerateDesignPromptClientResult = {
  text: string;
  generationId: string | null;
  history: AssetDesignPromptHistoryEntry[];
  capabilityId?: string;
  outputKind?: string;
};

/**
 * Formal design-prompt generate. Never falls back to extract seed.
 */
export async function requestFormalDesignPromptGenerate(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  item: EpisodeAssetDesignItem;
  userRequirement?: string;
  promptModelId?: DesignPromptModelId;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<GenerateDesignPromptClientResult> {
  const promptModelId = input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID;
  const url = buildItemGeneratePromptUrl({
    surface: input.surface,
    projectId: input.projectId,
    episodeId: input.episodeId,
    itemId: input.item.id,
  });
  const fingerprint = designPromptContentFingerprint(input.item);
  const idempotencyKey =
    input.idempotencyKey ??
    `prompt-auto-${input.item.id}-${fingerprint}-${promptModelId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({
      idempotencyKey,
      userRequirement: input.userRequirement ?? "",
      promptModelId,
    }),
  });
  const payload = (await res.json()) as {
    error?: string;
    prompt?: string;
    capabilityId?: string;
    outputKind?: string;
    designPrompt?: {
      text?: string;
      status?: string;
      history?: AssetDesignPromptHistoryEntry[];
      generationId?: string | null;
    };
  };
  if (!res.ok) {
    throw new Error(payload.error ?? "提示词生成失败");
  }
  const text =
    payload.prompt?.trim() || payload.designPrompt?.text?.trim() || "";
  if (!text) {
    throw new Error("模型未返回有效的资产设计提示词");
  }
  return {
    text,
    generationId: payload.designPrompt?.generationId ?? null,
    history: payload.designPrompt?.history ?? [],
    capabilityId: payload.capabilityId,
    outputKind: payload.outputKind,
  };
}

const DEFAULT_CONCURRENCY = 2;

/**
 * After extract apply: generate formal prompts for items missing valid text.
 */
export async function autoGenerateMissingFormalDesignPrompts(input: {
  surface: "project_management" | "workspace";
  projectId: string;
  episodeId: string;
  items: EpisodeAssetDesignItem[];
  promptModelId?: DesignPromptModelId;
  concurrency?: number;
  signal?: AbortSignal;
  onItemStart?: (item: EpisodeAssetDesignItem) => void;
  onItemSuccess?: (
    item: EpisodeAssetDesignItem,
    result: GenerateDesignPromptClientResult,
  ) => void;
  onItemError?: (item: EpisodeAssetDesignItem, error: Error) => void;
}): Promise<{ ok: number; failed: number }> {
  const targets = input.items.filter(itemNeedsFormalDesignPrompt);
  if (targets.length === 0) return { ok: 0, failed: 0 };

  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);
  let cursor = 0;
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (cursor < targets.length) {
      if (input.signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      const item = targets[index]!;
      input.onItemStart?.(item);
      try {
        const result = await requestFormalDesignPromptGenerate({
          surface: input.surface,
          projectId: input.projectId,
          episodeId: input.episodeId,
          item,
          userRequirement: "",
          promptModelId: input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID,
          signal: input.signal,
        });
        ok += 1;
        input.onItemSuccess?.(item, result);
      } catch (error) {
        failed += 1;
        input.onItemError?.(
          item,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () =>
      worker(),
    ),
  );
  return { ok, failed };
}
