/**
 * Incremental NDJSON parser for batch formal design-prompt generation.
 * Completes only on full lines; incomplete trailing lines are never counted.
 */

export type DesignPromptBatchAssetLine = {
  type: "asset";
  assetId: string;
  prompt: string;
  status: "completed";
};

export type DesignPromptBatchEndLine = {
  type: "batch_end";
  completedAssetIds: string[];
  failedAssetIds: string[];
  nextAssetId: string;
};

export type DesignPromptBatchParsedLine =
  | DesignPromptBatchAssetLine
  | DesignPromptBatchEndLine;

export type DesignPromptBatchNdjsonState = {
  buffer: string;
  partialContent: string;
  completed: Map<string, DesignPromptBatchAssetLine>;
  rejectedAssetIds: string[];
  batchEnd: DesignPromptBatchEndLine | null;
  sawBatchEnd: boolean;
};

export function createDesignPromptBatchNdjsonState(): DesignPromptBatchNdjsonState {
  return {
    buffer: "",
    partialContent: "",
    completed: new Map(),
    rejectedAssetIds: [],
    batchEnd: null,
    sawBatchEnd: false,
  };
}

function tryParseLine(
  line: string,
  allowedAssetIds: Set<string>,
):
  | { ok: true; value: DesignPromptBatchParsedLine }
  | { ok: false; reason: string; assetId?: string } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_line" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "json_parse_error" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "not_object" };
  }
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";

  if (type === "asset") {
    const assetId = typeof obj.asset_id === "string" ? obj.asset_id.trim() : "";
    const prompt = typeof obj.prompt === "string" ? obj.prompt : "";
    const status = typeof obj.status === "string" ? obj.status : "";
    if (!assetId) return { ok: false, reason: "missing_asset_id" };
    if (!allowedAssetIds.has(assetId)) {
      return { ok: false, reason: "unknown_asset_id", assetId };
    }
    if (status !== "completed") {
      return { ok: false, reason: "invalid_status", assetId };
    }
    if (!prompt.trim()) {
      return { ok: false, reason: "empty_prompt", assetId };
    }
    return {
      ok: true,
      value: {
        type: "asset",
        assetId,
        prompt,
        status: "completed",
      },
    };
  }

  if (type === "batch_end") {
    const completedAssetIds = Array.isArray(obj.completed_asset_ids)
      ? obj.completed_asset_ids
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    const failedAssetIds = Array.isArray(obj.failed_asset_ids)
      ? obj.failed_asset_ids
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];
    const nextAssetId =
      typeof obj.next_asset_id === "string" ? obj.next_asset_id.trim() : "";
    return {
      ok: true,
      value: {
        type: "batch_end",
        completedAssetIds,
        failedAssetIds,
        nextAssetId,
      },
    };
  }

  return { ok: false, reason: "unknown_type" };
}

export type DesignPromptBatchNdjsonPushResult = {
  newlyCompleted: DesignPromptBatchAssetLine[];
  rejected: Array<{ assetId?: string; reason: string; line: string }>;
};

/**
 * Feed a streaming text chunk. Returns newly accepted complete asset lines.
 */
export function pushDesignPromptBatchNdjsonChunk(
  state: DesignPromptBatchNdjsonState,
  chunk: string,
  allowedAssetIds: Set<string>,
): DesignPromptBatchNdjsonPushResult {
  state.partialContent += chunk;
  state.buffer += chunk;
  const newlyCompleted: DesignPromptBatchAssetLine[] = [];
  const rejected: Array<{ assetId?: string; reason: string; line: string }> = [];

  const parts = state.buffer.split("\n");
  state.buffer = parts.pop() ?? "";

  for (const part of parts) {
    const parsed = tryParseLine(part, allowedAssetIds);
    if (!parsed.ok) {
      if (parsed.reason !== "empty_line") {
        rejected.push({
          assetId: parsed.assetId,
          reason: parsed.reason,
          line: part.trim().slice(0, 200),
        });
        if (parsed.assetId) {
          state.rejectedAssetIds.push(parsed.assetId);
        }
      }
      continue;
    }
    if (parsed.value.type === "batch_end") {
      state.sawBatchEnd = true;
      state.batchEnd = parsed.value;
      continue;
    }
    if (state.completed.has(parsed.value.assetId)) {
      // First valid result wins; duplicates ignored.
      continue;
    }
    state.completed.set(parsed.value.assetId, parsed.value);
    newlyCompleted.push(parsed.value);
  }

  return { newlyCompleted, rejected };
}

export function finalizeDesignPromptBatchNdjson(
  state: DesignPromptBatchNdjsonState,
  allowedAssetIds: Set<string>,
): DesignPromptBatchNdjsonPushResult {
  // Incomplete trailing buffer must not count as completed.
  const trailing = state.buffer.trim();
  if (!trailing) {
    return { newlyCompleted: [], rejected: [] };
  }
  const parsed = tryParseLine(trailing, allowedAssetIds);
  if (!parsed.ok) {
    return {
      newlyCompleted: [],
      rejected: [
        {
          assetId: parsed.assetId,
          reason: parsed.reason === "json_parse_error" ? "incomplete_line" : parsed.reason,
          line: trailing.slice(0, 200),
        },
      ],
    };
  }
  // A complete final line without newline is still valid (stream ended cleanly).
  state.buffer = "";
  if (parsed.value.type === "batch_end") {
    state.sawBatchEnd = true;
    state.batchEnd = parsed.value;
    return { newlyCompleted: [], rejected: [] };
  }
  if (state.completed.has(parsed.value.assetId)) {
    return { newlyCompleted: [], rejected: [] };
  }
  state.completed.set(parsed.value.assetId, parsed.value);
  return { newlyCompleted: [parsed.value], rejected: [] };
}

export function nextIncompleteAssetId(
  requestedAssetIds: string[],
  completedIds: Set<string>,
): string {
  return requestedAssetIds.find((id) => !completedIds.has(id)) ?? "";
}

export function halfBatchSize(remaining: number, previousBatchSize: number): number {
  const half = Math.floor(Math.max(1, previousBatchSize) / 2);
  return Math.max(1, Math.min(remaining, half || 1));
}
