import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("script upload auto-split UI contract", () => {
  const workspace = readSrc(
    "src/projects/script/ScriptCreationWorkspace.tsx",
  );
  const upload = readSrc("src/projects/script/ScriptUploadPanel.tsx");
  const editor = readSrc("src/projects/script/ScriptDocumentEditor.tsx");
  const processPanel = readSrc("src/projects/script/ScriptProcessPanel.tsx");

  it("upload success persists with autoSplit and does not wait for 确认分集", () => {
    expect(workspace).toContain("persistImportedScriptAndAutoSplit");
    expect(workspace).toContain("autoSplit: true");
    expect(workspace).toContain("postScriptImportByFile");
    const uploadBlock = workspace.slice(
      workspace.indexOf("const handleScriptFile"),
      workspace.indexOf("const handleCancelImport"),
    );
    expect(uploadBlock).toContain("persistImportedScriptAndAutoSplit(preview)");
    expect(uploadBlock).not.toContain("setImportPreview(preview)");
  });

  it("wires confirm-import through the same persist+auto-split path", () => {
    const confirmBlock = workspace.slice(
      workspace.indexOf("const handleConfirmImport"),
      workspace.indexOf("const handleStartSplit"),
    );
    expect(confirmBlock).toContain("persistImportedScriptAndAutoSplit");
    expect(confirmBlock).not.toContain("episodes: []");
    expect(confirmBlock).not.toContain("runLocalSplit");
  });

  it("local-split retry auto-confirms formal episodes", () => {
    const runLocal = workspace.slice(
      workspace.indexOf("const runLocalSplit"),
      workspace.indexOf("const handleConfirmImport"),
    );
    expect(runLocal).toContain("local-split");
    expect(runLocal).toContain("formatScriptAutoSplitNote");
    expect(runLocal).not.toContain("请核对各集后确认剧本");
  });

  it("shows the formal episode list after confirmed auto-split", () => {
    expect(workspace).toContain("scriptShowsFormalEpisodeList");
    expect(workspace).toContain('data-testid="script-auto-split-note"');
    expect(processPanel).toContain('data-testid="script-episode-list"');
    expect(processPanel).toContain("script-episode-${ep.episodeNumber}");
    expect(workspace).toContain("showFormalEpisodeList");
  });

  it("does not treat pending/failed downstream sync as ordinary success", () => {
    expect(workspace).toContain("downstreamSync");
    expect(workspace).toContain("formatScriptAutoSplitNote");
    const noteHelper = readSrc("src/projects/script/script-auto-split-ui.ts");
    expect(noteHelper).toContain("工作台同步进行中，尚未完成。");
    expect(noteHelper).toContain("工作台同步失败，请从同步状态重试。");
  });

  it("upload panel and editor copy no longer require an extra confirm-split click", () => {
    expect(upload).toContain("将自动保存并创建剧集");
    expect(upload).not.toContain("确认导入后将自动生成分集方案");
    expect(editor).not.toContain("确认导入后将自动生成分集方案");
    expect(workspace).toContain("上传剧本后将自动分集并创建剧集");
    expect(workspace).not.toContain('outputKind: "script_split"');
    expect(workspace).not.toContain("apply-split");
  });

  it("guards duplicate in-flight split and stale async overwrite", () => {
    expect(workspace).toContain("splitInFlightRef");
    expect(workspace).toContain("splitRequestSeqRef");
    expect(workspace).toMatch(
      /handleScriptFile[\s\S]*splitRequestSeqRef\.current \+= 1/,
    );
  });
});
