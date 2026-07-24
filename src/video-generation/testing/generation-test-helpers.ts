import { readGenerationRecord } from "@/video-generation/generation-store";
import type { GenerationRecord } from "@/video-generation/types";

/** 测试辅助：读取本地 generation 记录。勿从 Next Route 导出。 */
export async function getGenerationForTests(
  id: string,
): Promise<GenerationRecord | null> {
  return readGenerationRecord(id);
}
