import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

/**
 * 阿里云 DashScope OpenAI-compatible Chat Completions（流式）。
 * Base URL / Key 仅服务端环境变量，禁止 NEXT_PUBLIC_。
 */
export class DashScopeTextProvider implements TextGenerationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.apiKey = (env.DASHSCOPE_API_KEY ?? "").trim();
    const region = (env.DASHSCOPE_REGION ?? "cn-beijing").trim();
    const defaultBase =
      region === "ap-southeast-1" || region === "singapore"
        ? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1";
    this.baseUrl = (
      env.DASHSCOPE_COMPATIBLE_BASE_URL?.trim() || defaultBase
    ).replace(/\/$/, "");
  }

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

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.providerModelId,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: input.maxOutputTokens,
          messages,
        }),
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) {
        yield { type: "error", code: "CANCELLED", message: "已取消" };
        return;
      }
      yield {
        type: "error",
        code: "NETWORK_ERROR",
        message: "连接模型服务失败",
      };
      void error;
      return;
    }

    if (!res.ok || !res.body) {
      const code =
        res.status === 429
          ? "PROVIDER_RATE_LIMIT"
          : res.status === 401 || res.status === 403
            ? "PROVIDER_AUTH"
            : "PROVIDER_ERROR";
      yield {
        type: "error",
        code,
        message:
          res.status === 429
            ? "模型服务限流，请稍后再试"
            : "模型服务暂时不可用",
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;

    try {
      while (true) {
        if (input.signal?.aborted) {
          yield { type: "error", code: "CANCELLED", message: "已取消" };
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            yield {
              type: "usage",
              inputTokens,
              outputTokens,
            };
            yield { type: "done" };
            return;
          }
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
              };
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield { type: "delta", text: delta };
            if (json.usage) {
              inputTokens = json.usage.prompt_tokens ?? inputTokens;
              outputTokens = json.usage.completion_tokens ?? outputTokens;
            }
          } catch {
            // skip malformed chunk
          }
        }
      }
      yield { type: "usage", inputTokens, outputTokens };
      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
  }
}
