import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("local script split UI contract", () => {
  const workspace = readSrc(
    "src/projects/script/ScriptCreationWorkspace.tsx",
  );
  const upload = readSrc("src/projects/script/ScriptUploadPanel.tsx");

  it("wires 分集 to local-split API instead of LLM script_split", () => {
    expect(workspace).toContain("分集");
    expect(workspace).toContain("确认剧本");
    expect(workspace).toContain("local-split");
    expect(workspace).not.toContain('outputKind: "script_split"');
    expect(workspace).not.toContain("apply-split");
    expect(workspace).not.toContain("streamStoryGeneration");
  });

  it("upload panel lights split after import and shows 已分集 when done", () => {
    expect(upload).toContain("分集");
    expect(upload).toContain("已分集");
    expect(upload).toContain("本地分集");
    expect(upload).toContain("onOpenSplit");
    expect(upload).toContain("splitDone");
    expect(upload).toContain('data-testid="script-split-start"');
    expect(workspace).not.toContain('data-testid="script-split-start"');
  });
});
