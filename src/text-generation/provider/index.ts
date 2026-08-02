import { DashScopeTextProvider } from "@/text-generation/provider/dashscope-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";

export function createTextGenerationProvider(
  env: NodeJS.ProcessEnv = process.env,
): TextGenerationProvider {
  const raw = (env.TEXT_LLM_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "dashscope") {
    return new DashScopeTextProvider(env);
  }
  return new MockTextProvider();
}
