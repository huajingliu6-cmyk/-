/**
 * Client for POST .../text-generations (SSE).
 * Does not call stubs or invent mock story text.
 */

export type StoryGenerationStreamMeta = {
  generationId: string;
  displayModelName?: string;
  targetChars?: number;
  reservedPoints?: number;
  reused?: boolean;
};

export type StoryGenerationStreamResult = {
  generationId: string;
  text: string;
  displayModelName?: string;
  reservedPoints?: number;
  chargedPoints?: number;
  actualChars?: number;
  reused?: boolean;
};

export type StoryGenerationStreamError = {
  code: string;
  message: string;
};

export class StoryGenerationClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StoryGenerationClientError";
    this.code = code;
  }
}

export type StartStoryGenerationInput = {
  projectId: string;
  brief: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
  /** Defaults to story for backward-compatible callers. */
  outputKind?:
    | "story"
    | "script"
    | "script_outline"
    | "script_episodes"
    | "script_split"
    | "episode_asset_design"
    | "asset_design_prompt";
  /** Required for script_episodes — must match saved draft.outlineText. */
  outlineText?: string;
  /** Required for script_episodes — UI episode number 1–8. */
  episodeNumber?: number;
  /** Required for episode_asset_design. */
  episodeId?: string;
  signal?: AbortSignal;
  onMeta?: (meta: StoryGenerationStreamMeta) => void;
  onDelta?: (accumulatedText: string) => void;
};

function parseSseBlocks(buffer: string): {
  events: { event: string; data: string }[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: { event: string; data: string }[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

export function createStoryGenerationIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `story_${crypto.randomUUID()}`;
  }
  return `story_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createScriptOutlineIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `outline_${crypto.randomUUID()}`;
  }
  return `outline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createScriptEpisodesIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `episodes_${crypto.randomUUID()}`;
  }
  return `episodes_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stream a text generation. Resolves with final text on `done`.
 * Rejects with StoryGenerationClientError on SSE `error` or HTTP failure.
 */
export async function streamStoryGeneration(
  input: StartStoryGenerationInput,
): Promise<StoryGenerationStreamResult> {
  const outputKind = input.outputKind ?? "story";
  const res = await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/text-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: input.signal,
      body: JSON.stringify({
        outputKind,
        brief: input.brief,
        modelKey: input.modelKey,
        targetChars: input.targetChars,
        idempotencyKey: input.idempotencyKey,
        ...(outputKind === "script_episodes"
          ? {
              outlineText: input.outlineText ?? "",
              episodeNumber: input.episodeNumber,
            }
          : {}),
        ...(outputKind === "episode_asset_design"
          ? { episodeId: input.episodeId }
          : {}),
      }),
    },
  );

  if (!res.ok) {
    let message = `生成失败（${res.status}）`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      /* ignore */
    }
    throw new StoryGenerationClientError(
      res.status === 401
        ? "UNAUTHORIZED"
        : res.status === 403
          ? "FORBIDDEN"
          : "HTTP_ERROR",
      message,
    );
  }

  if (!res.body) {
    throw new StoryGenerationClientError("NO_BODY", "生成响应为空");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let generationId = "";
  let displayModelName: string | undefined;
  let reservedPoints: number | undefined;
  let chargedPoints: number | undefined;
  let actualChars: number | undefined;
  let reused: boolean | undefined;
  let sawDone = false;
  let streamError: StoryGenerationStreamError | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBlocks(buffer);
    buffer = parsed.rest;
    for (const ev of parsed.events) {
      let data: unknown = {};
      try {
        data = ev.data ? JSON.parse(ev.data) : {};
      } catch {
        data = {};
      }
      const obj = data as Record<string, unknown>;
      if (ev.event === "meta") {
        generationId =
          typeof obj.generationId === "string" ? obj.generationId : generationId;
        displayModelName =
          typeof obj.displayModelName === "string"
            ? obj.displayModelName
            : displayModelName;
        reservedPoints =
          typeof obj.reservedPoints === "number"
            ? obj.reservedPoints
            : reservedPoints;
        reused = typeof obj.reused === "boolean" ? obj.reused : reused;
        input.onMeta?.({
          generationId,
          displayModelName,
          targetChars:
            typeof obj.targetChars === "number" ? obj.targetChars : undefined,
          reservedPoints,
          reused,
        });
      } else if (ev.event === "delta") {
        const chunk = typeof obj.text === "string" ? obj.text : "";
        if (chunk) {
          text += chunk;
          input.onDelta?.(text);
        }
      } else if (ev.event === "usage") {
        chargedPoints =
          typeof obj.chargedPoints === "number"
            ? obj.chargedPoints
            : chargedPoints;
        actualChars =
          typeof obj.actualChars === "number" ? obj.actualChars : actualChars;
      } else if (ev.event === "done") {
        if (typeof obj.generationId === "string") {
          generationId = obj.generationId;
        }
        sawDone = true;
      } else if (ev.event === "error") {
        streamError = {
          code: typeof obj.code === "string" ? obj.code : "ERROR",
          message:
            typeof obj.message === "string" ? obj.message : "生成失败",
        };
      }
    }
    if (streamError || sawDone) break;
  }

  if (streamError) {
    throw new StoryGenerationClientError(streamError.code, streamError.message);
  }
  if (!sawDone) {
    throw new StoryGenerationClientError(
      "INCOMPLETE",
      "生成未完成或连接已中断",
    );
  }
  if (!generationId) {
    throw new StoryGenerationClientError("MISSING_ID", "缺少 generationId");
  }

  return {
    generationId,
    text,
    displayModelName,
    reservedPoints,
    chargedPoints,
    actualChars,
    reused,
  };
}

export async function cancelStoryGeneration(
  projectId: string,
  generationId: string,
): Promise<void> {
  await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/text-generations/${encodeURIComponent(generationId)}/cancel`,
    { method: "POST", credentials: "include" },
  );
}

/** Notify shell credit widgets to refresh without inventing balances. */
export function notifyCreditsRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("ic-credits-refresh"));
}
