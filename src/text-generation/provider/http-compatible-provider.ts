import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

/**
 * DeepSeek OpenAI-compatible IDs are lowercase (`deepseek-v4-pro`).
 * Admin UI often saves display casing like `DeepSeek-V4-Pro`, which the API rejects.
 */
export function normalizeHttpCompatibleModelId(
  baseUrl: string,
  modelId: string,
): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (host.includes("deepseek.com") || /deepseek/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase().includes("deepseek.com");
  } catch {
    return /deepseek/i.test(baseUrl);
  }
}

/**
 * DeepSeek V4 defaults to thinking=enabled; reasoning tokens share max_tokens.
 * Default: disable thinking for structured/short outputs.
 * Pass enableThinking=true for asset extract / design prompts that need depth.
 */
export function buildHttpCompatibleChatBody(input: {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxOutputTokens: number;
  stream: boolean;
  enableThinking?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream: input.stream,
    max_tokens: input.maxOutputTokens,
    messages: input.messages,
  };
  if (isDeepSeekEndpoint(input.baseUrl) || /deepseek/i.test(input.model)) {
    body.thinking = {
      type: input.enableThinking ? "enabled" : "disabled",
    };
  }
  return body;
}

type StreamChunk =
  | {
      kind: "delta";
      text: string;
      inputTokens?: number;
      outputTokens?: number;
      finishReason?: string | null;
    }
  | { kind: "error"; event: ProviderTextStreamEvent };

/**
 * OpenAI-compatible Chat Completions stream using admin-configured
 * baseUrl / apiKey / model (never from the client).
 *
 * Yields non-empty delta.content chunks as soon as they arrive.
 * Non-stream fallback runs only when the stream ends with zero body text.
 */
export class HttpCompatibleTextProvider implements TextGenerationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly defaultModelId: string,
  ) {}

  estimateInputTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 1.8));
  }

  estimateMaxOutputTokens(
    targetChars: number,
    factor: number,
    cap: number,
  ): number {
    return Math.min(cap, Math.ceil(targetChars * factor) + 48);
  }

  async *streamText(input: {
    systemPrompt: string;
    userPrompt: string;
    providerModelId: string;
    maxOutputTokens: number;
    signal?: AbortSignal;
    enableThinking?: boolean;
    messages?: Array<{ role: string; content: string }>;
  }): AsyncGenerator<ProviderTextStreamEvent, void, unknown> {
    if (!this.apiKey) {
      yield {
        type: "error",
        code: "MODEL_NOT_CONFIGURED",
        message: "文本模型 API Key 未配置",
      };
      return;
    }

    const model = normalizeHttpCompatibleModelId(
      this.baseUrl,
      input.providerModelId || this.defaultModelId || "default",
    );
    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const messages =
      input.messages && input.messages.length > 0
        ? input.messages.map((m) => ({
            role: m.role,
            content: m.content,
          }))
        : [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt },
          ];
    const enableThinking = Boolean(input.enableThinking);

    let receivedAnyText = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | null = null;

    for await (const chunk of this.iterateStreamingCompletion({
      endpoint,
      model,
      messages,
      maxOutputTokens: input.maxOutputTokens,
      enableThinking,
      signal: input.signal,
    })) {
      if (chunk.kind === "error") {
        yield chunk.event;
        return;
      }
      if (chunk.inputTokens) inputTokens = chunk.inputTokens;
      if (chunk.outputTokens) outputTokens = chunk.outputTokens;
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.text) {
        receivedAnyText = true;
        yield { type: "delta", text: chunk.text };
      }
    }

    // Fallback only when the stream completed with no usable body.
    if (!receivedAnyText) {
      const nonStream = await this.readNonStreamingCompletion({
        endpoint,
        model,
        messages,
        maxOutputTokens: input.maxOutputTokens,
        enableThinking,
        signal: input.signal,
      });
      if (nonStream.kind === "error") {
        yield nonStream.event;
        return;
      }
      if (nonStream.text.trim()) {
        receivedAnyText = true;
        inputTokens = nonStream.inputTokens || inputTokens;
        outputTokens = nonStream.outputTokens || outputTokens;
        finishReason = nonStream.finishReason ?? finishReason;
        yield { type: "delta", text: nonStream.text };
      } else {
        finishReason = nonStream.finishReason ?? finishReason;
      }
    }

    if (!receivedAnyText) {
      yield {
        type: "error",
        code: "EMPTY_MODEL_OUTPUT",
        message:
          finishReason === "length"
            ? "模型输出被长度上限截断且正文为空（常见于推理模型先耗尽 thinking token）。请重试；若仍失败，可在管理后台改用非推理模型或提高输出上限。"
            : finishReason
              ? `模型输出为空（finish_reason=${finishReason}）。对方可能已按输入 token 扣费，但未返回可用正文。`
              : "模型输出为空。对方可能已按输入 token 扣费，但流式/非流式均未返回可用正文。",
      };
      return;
    }

    const estimateSource =
      input.messages && input.messages.length > 0
        ? input.messages.map((m) => m.content).join("\n")
        : input.systemPrompt + input.userPrompt;

    const resolvedInputTokens =
      inputTokens || this.estimateInputTokens(estimateSource);
    const resolvedOutputTokens = outputTokens || 0;
    yield {
      type: "usage",
      inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens,
      finishReason,
    };
    yield {
      type: "done",
      inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens,
      finishReason,
    };
  }

  /**
   * Yields each non-empty content delta as soon as SSE (or JSON body) provides it.
   */
  private async *iterateStreamingCompletion(input: {
    endpoint: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    maxOutputTokens: number;
    enableThinking?: boolean;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamChunk, void, unknown> {
    let res: Response;
    try {
      res = await fetch(input.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildHttpCompatibleChatBody({
            baseUrl: this.baseUrl,
            model: input.model,
            messages: input.messages,
            maxOutputTokens: input.maxOutputTokens,
            stream: true,
            enableThinking: input.enableThinking,
          }),
        ),
        signal: input.signal,
      });
    } catch {
      if (input.signal?.aborted) {
        yield {
          kind: "error",
          event: { type: "error", code: "CANCELLED", message: "已取消" },
        };
        return;
      }
      yield {
        kind: "error",
        event: {
          type: "error",
          code: "NETWORK_ERROR",
          message: "连接模型服务失败",
        },
      };
      return;
    }

    if (!res.ok || !res.body) {
      yield { kind: "error", event: await httpErrorEvent(res) };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawSseData = false;
    let emittedJsonBody = false;

    try {
      while (true) {
        if (input.signal?.aborted) {
          yield {
            kind: "error",
            event: { type: "error", code: "CANCELLED", message: "已取消" },
          };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        if (!sawSseData && !emittedJsonBody && buffer.trimStart().startsWith("{")) {
          const maybeComplete = tryParseJsonObject(buffer);
          if (maybeComplete) {
            const extracted = extractCompletionText(maybeComplete);
            emittedJsonBody = true;
            if (extracted.text) {
              yield {
                kind: "delta",
                text: extracted.text,
                inputTokens: extracted.inputTokens || undefined,
                outputTokens: extracted.outputTokens || undefined,
                finishReason: extracted.finishReason,
              };
            } else if (extracted.finishReason || extracted.inputTokens || extracted.outputTokens) {
              yield {
                kind: "delta",
                text: "",
                inputTokens: extracted.inputTokens || undefined,
                outputTokens: extracted.outputTokens || undefined,
                finishReason: extracted.finishReason,
              };
            }
            buffer = "";
            break;
          }
        }

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") continue;
          sawSseData = true;
          try {
            const extracted = extractCompletionText(JSON.parse(data));
            if (extracted.text) {
              yield {
                kind: "delta",
                text: extracted.text,
                inputTokens: extracted.inputTokens || undefined,
                outputTokens: extracted.outputTokens || undefined,
                finishReason: extracted.finishReason,
              };
            } else if (
              extracted.finishReason ||
              extracted.inputTokens ||
              extracted.outputTokens
            ) {
              yield {
                kind: "delta",
                text: "",
                inputTokens: extracted.inputTokens || undefined,
                outputTokens: extracted.outputTokens || undefined,
                finishReason: extracted.finishReason,
              };
            }
          } catch {
            /* ignore non-JSON SSE */
          }
        }
      }

      // Flush remaining buffer as a final SSE data line if present.
      const trailing = buffer.trim();
      if (trailing.startsWith("data:")) {
        const data = trailing.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            const extracted = extractCompletionText(JSON.parse(data));
            if (extracted.text) {
              yield {
                kind: "delta",
                text: extracted.text,
                inputTokens: extracted.inputTokens || undefined,
                outputTokens: extracted.outputTokens || undefined,
                finishReason: extracted.finishReason,
              };
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      if (input.signal?.aborted) {
        yield {
          kind: "error",
          event: { type: "error", code: "CANCELLED", message: "已取消" },
        };
        return;
      }
      yield {
        kind: "error",
        event: {
          type: "error",
          code: "NETWORK_ERROR",
          message: "读取模型流式响应失败",
        },
      };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private async readNonStreamingCompletion(input: {
    endpoint: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    maxOutputTokens: number;
    enableThinking?: boolean;
    signal?: AbortSignal;
  }): Promise<
    | {
        kind: "ok";
        text: string;
        inputTokens: number;
        outputTokens: number;
        finishReason: string | null;
      }
    | { kind: "error"; event: ProviderTextStreamEvent }
  > {
    let res: Response;
    try {
      res = await fetch(input.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildHttpCompatibleChatBody({
            baseUrl: this.baseUrl,
            model: input.model,
            messages: input.messages,
            maxOutputTokens: input.maxOutputTokens,
            stream: false,
            enableThinking: input.enableThinking,
          }),
        ),
        signal: input.signal,
      });
    } catch {
      if (input.signal?.aborted) {
        return {
          kind: "error",
          event: { type: "error", code: "CANCELLED", message: "已取消" },
        };
      }
      return {
        kind: "error",
        event: {
          type: "error",
          code: "NETWORK_ERROR",
          message: "连接模型服务失败",
        },
      };
    }

    if (!res.ok) {
      return { kind: "error", event: await httpErrorEvent(res) };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return {
        kind: "error",
        event: {
          type: "error",
          code: "PROVIDER_HTTP_ERROR",
          message: "模型服务返回了无法解析的非流式响应",
        },
      };
    }

    const extracted = extractCompletionText(json);
    return {
      kind: "ok",
      text: extracted.text,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      finishReason: extracted.finishReason,
    };
  }
}

async function httpErrorEvent(res: Response): Promise<ProviderTextStreamEvent> {
  let detail = "";
  try {
    detail = (await res.text()).trim().slice(0, 240);
  } catch {
    /* ignore */
  }
  return {
    type: "error",
    code: "PROVIDER_HTTP_ERROR",
    message: detail
      ? `模型服务返回错误（${res.status}）：${detail}`
      : `模型服务返回错误（${res.status}）`,
  };
}

function tryParseJsonObject(raw: string): unknown | null {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

function coerceTextPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.content === "string") return obj.content;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function extractCompletionText(json: unknown): {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string | null;
} {
  if (!json || typeof json !== "object") {
    return { text: "", inputTokens: 0, outputTokens: 0, finishReason: null };
  }
  const root = json as Record<string, unknown>;
  const usage =
    root.usage && typeof root.usage === "object"
      ? (root.usage as Record<string, unknown>)
      : null;
  const inputTokens =
    typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const outputTokens =
    typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;

  const choices = Array.isArray(root.choices) ? root.choices : [];
  let text = "";
  let finishReason: string | null = null;
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const c = choice as Record<string, unknown>;
    if (typeof c.finish_reason === "string") finishReason = c.finish_reason;
    const delta =
      c.delta && typeof c.delta === "object"
        ? (c.delta as Record<string, unknown>)
        : null;
    const message =
      c.message && typeof c.message === "object"
        ? (c.message as Record<string, unknown>)
        : null;
    text += coerceTextPart(delta?.content);
    text += coerceTextPart(message?.content);
    text += coerceTextPart(delta?.text);
    text += coerceTextPart(message?.text);
    if (typeof c.text === "string") text += c.text;
  }

  // 部分 Gemini 兼容层只在 candidates 里给正文。
  if (!text.trim() && Array.isArray(root.candidates)) {
    for (const cand of root.candidates) {
      if (!cand || typeof cand !== "object") continue;
      const content = (cand as Record<string, unknown>).content;
      if (!content || typeof content !== "object") continue;
      text += coerceTextPart((content as Record<string, unknown>).parts);
      text += coerceTextPart((content as Record<string, unknown>).text);
    }
  }

  return { text, inputTokens, outputTokens, finishReason };
}
