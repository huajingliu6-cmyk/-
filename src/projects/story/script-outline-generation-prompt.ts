/**
 * Build the script-outline text-generations request from page fields.
 * Server builds LLM prompts; this only packages user-visible inputs.
 */

export type ScriptOutlineGenerationRequestBody = {
  outputKind: "script_outline";
  brief: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
};

/** Default outline length when UI shows「自动控制」. */
export const SCRIPT_OUTLINE_TARGET_CHARS_DEFAULT = 500;

export function buildScriptOutlineGenerationRequest(input: {
  brief: string;
  modelKey: string;
  targetChars?: number;
  idempotencyKey: string;
}): ScriptOutlineGenerationRequestBody {
  const target =
    typeof input.targetChars === "number" && Number.isFinite(input.targetChars)
      ? Math.trunc(input.targetChars)
      : SCRIPT_OUTLINE_TARGET_CHARS_DEFAULT;
  return {
    outputKind: "script_outline",
    brief: input.brief,
    modelKey: input.modelKey,
    targetChars: Math.min(1000, Math.max(100, target)),
    idempotencyKey: input.idempotencyKey,
  };
}

export function assertSafeScriptOutlineGenerationRequest(
  body: ScriptOutlineGenerationRequestBody,
): void {
  const serialized = JSON.stringify(body);
  if (
    /cookie|password|authorization|api[_-]?key|\\\\|file:\/\//i.test(
      serialized,
    )
  ) {
    throw new Error("大纲生成请求包含不允许的敏感字段");
  }
}
