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
  const editor = readSrc("src/projects/script/ScriptDocumentEditor.tsx");
  const processPanel = readSrc("src/projects/script/ScriptProcessPanel.tsx");

  it("wires upload auto persist+split instead of LLM script_split", () => {
    expect(workspace).toContain("确认剧本");
    expect(workspace).toContain("local-split");
    expect(workspace).toContain("runLocalSplit");
    expect(workspace).toContain("persistImportedScriptAndAutoSplit");
    expect(workspace).toContain("autoSplit: true");
    expect(workspace).not.toContain('outputKind: "script_split"');
    expect(workspace).not.toContain("apply-split");
    expect(workspace).not.toContain("streamStoryGeneration");
  });

  it("upload panel no longer renders a standalone 分集/已分集 button", () => {
    expect(upload).not.toContain("onOpenSplit");
    expect(upload).not.toContain("splitDone");
    expect(upload).not.toContain("canSplit");
    expect(upload).not.toContain('data-testid="script-split-start"');
    expect(upload).not.toContain("已分集");
    expect(upload).toContain("上传剧本文件");
    expect(upload).toContain("处理中…");
    expect(upload).toContain("将自动保存并创建剧集");
    expect(upload).toContain("script-upload-remove");
    expect(upload).toContain("onRemove");
    expect(workspace).toContain("clearScript: true");
    expect(workspace).toContain("replaceExisting");
    expect(workspace).toContain("handleRemoveUploadedScript");
    expect(workspace).not.toContain('data-testid="script-split-start"');
    expect(workspace).not.toContain("canSplit={canSplit}");
    expect(workspace).not.toContain("splitDone={splitDone}");
    expect(workspace).not.toContain("onOpenSplit");
  });

  it("auto-split after upload does not require an extra confirm-import click", () => {
    expect(workspace).toMatch(
      /handleScriptFile[\s\S]*persistImportedScriptAndAutoSplit\(preview\)/,
    );
    expect(workspace).not.toContain("请点击「分集」进行本地分集");
    const confirmBlock = workspace.slice(
      workspace.indexOf("const handleConfirmImport"),
      workspace.indexOf("const handleStartSplit"),
    );
    expect(confirmBlock).toContain("persistImportedScriptAndAutoSplit");
    expect(confirmBlock).not.toContain("episodes: []");
  });

  it("TXT / DOCX / Markdown share the same auto-split path after upload", () => {
    expect(workspace).toContain("postScriptImportByFile");
    expect(workspace).toContain("scriptSourceFileTypeFromFormat");
    expect(workspace).not.toContain("DOCX 源文本已保存。请点击");
    expect(workspace).not.toContain("Markdown 源文本已保存。请点击");
    expect(workspace).not.toContain("TXT 源文本已保存。请点击");
    expect(workspace).toContain('setSplitStage("剧本已导入，正在自动分集…")');
  });

  it("successful auto-split writes formal episodes without a confirm-split click", () => {
    expect(workspace).toContain("formatScriptAutoSplitNote");
    expect(workspace).toContain("applyDraftToState(payload.draft");
    expect(workspace).toContain("scriptShowsFormalEpisodeList");
    const runLocalSplitBlock = workspace.slice(
      workspace.indexOf("const runLocalSplit"),
      workspace.indexOf("const handleConfirmImport"),
    );
    expect(runLocalSplitBlock).not.toContain("confirm-split");
    const autoImportBlock = workspace.slice(
      workspace.indexOf("const persistImportedScriptAndAutoSplit"),
      workspace.indexOf("const handleScriptFile"),
    );
    expect(autoImportBlock).toContain("autoSplit: true");
    expect(autoImportBlock).not.toContain("/assets");
    expect(processPanel).toContain('data-testid="script-episode-list"');
  });

  it("keeps 重新分集 recovery and shared runLocalSplit for retry", () => {
    expect(workspace).toContain("重新分集");
    expect(workspace).toContain("自动分集失败，请点击重新分集");
    const retryBlock = workspace.slice(
      workspace.indexOf("const handleStartSplit"),
      workspace.indexOf("const handleCancelSplit"),
    );
    expect(retryBlock).toContain("runLocalSplit");
    expect(retryBlock).toContain("body: {}");
  });

  it("guards against duplicate local-split and stale async overwrite", () => {
    expect(workspace).toContain("splitInFlightRef");
    expect(workspace).toContain("splitRequestSeqRef");
    expect(workspace).toContain("confirmingImport || splitInFlightRef.current");
    expect(workspace).toMatch(
      /handleScriptFile[\s\S]*splitRequestSeqRef\.current \+= 1/,
    );
  });

  it("replaces old manual-split copy with auto-split wording", () => {
    expect(workspace).not.toContain("请点击「分集」");
    expect(workspace).not.toContain("请先上传剧本并点击「分集」");
    expect(workspace).not.toContain("请使用「分集」生成方案");
    expect(editor).toContain("上传成功后将自动分集");
    expect(processPanel).toContain("上传剧本后将自动分集并创建剧集");
    expect(workspace).toContain("正在自动生成分集方案");
    expect(workspace).toContain("剧本导入后会自动分集");
  });
});
