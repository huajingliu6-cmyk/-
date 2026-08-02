/**
 * Build the story text-generations request body from page fields.
 * Server builds the actual LLM prompts; this only packages user-visible inputs.
 */

export type StoryGenerationRequestBody = {
  outputKind: "story";
  brief: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
};

export function buildStoryGenerationRequest(input: {
  brief: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
}): StoryGenerationRequestBody {
  return {
    outputKind: "story",
    brief: input.brief,
    modelKey: input.modelKey,
    targetChars: input.targetChars,
    idempotencyKey: input.idempotencyKey,
  };
}

/** Guard: request must never carry secrets or paths. */
export function assertSafeStoryGenerationRequest(
  body: StoryGenerationRequestBody,
): void {
  const serialized = JSON.stringify(body);
  if (
    /cookie|password|authorization|api[_-]?key|\\\\|file:\/\//i.test(
      serialized,
    )
  ) {
    throw new Error("故事生成请求包含不允许的敏感字段");
  }
}
