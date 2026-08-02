export type ScriptTextBlock = {
  id: string;
  text: string;
};

const BLOCK_ID_RE = /^B(\d{6})$/;

export function formatBlockId(index: number): string {
  return `B${String(index).padStart(6, "0")}`;
}

export function parseBlockIdIndex(id: string): number | null {
  const m = BLOCK_ID_RE.exec(id);
  if (!m) return null;
  return Number.parseInt(m[1]!, 10);
}

/**
 * Split source text into numbered blocks. Prefers paragraph breaks (blank lines);
 * falls back to single newlines when no paragraph breaks exist.
 */
export function splitSourceTextIntoBlocks(sourceText: string): ScriptTextBlock[] {
  const normalized = sourceText.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  let segments = normalized
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length <= 1 && normalized.includes("\n")) {
    segments = normalized
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const blocks: ScriptTextBlock[] = [];
  let blockIndex = 0;
  for (const text of segments) {
    blockIndex += 1;
    blocks.push({
      id: formatBlockId(blockIndex),
      text,
    });
  }
  return blocks;
}

export function buildScriptSplitProviderBrief(
  sourceText: string,
  userBrief?: string,
): string {
  const blocks = splitSourceTextIntoBlocks(sourceText);
  const lines = blocks.map((b) => `[${b.id}] ${b.text}`);
  const parts = [
    "【剧本块列表】",
    ...lines,
    userBrief?.trim() ? `【分集要求】\n${userBrief.trim()}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}
