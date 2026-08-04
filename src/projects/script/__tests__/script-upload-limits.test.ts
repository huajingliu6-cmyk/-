import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildScriptMarkdownImportPreview } from "@/projects/script/script-markdown-import";
import { buildScriptTxtImportPreview } from "@/projects/script/script-txt-import";
import {
  SCRIPT_UPLOAD_MAX_CHARS,
  SCRIPT_UPLOAD_MAX_CHARS_LABEL,
  validateScriptUploadCharacterCount,
} from "@/projects/script/script-upload-limits";

const encoder = new TextEncoder();

describe("script upload character limit", () => {
  it("allows exactly 10 万字 and rejects one extra character", () => {
    expect(validateScriptUploadCharacterCount(SCRIPT_UPLOAD_MAX_CHARS)).toBeNull();
    expect(
      validateScriptUploadCharacterCount(SCRIPT_UPLOAD_MAX_CHARS + 1),
    ).toContain(SCRIPT_UPLOAD_MAX_CHARS_LABEL);
  });

  it("rejects oversized TXT after decoding", () => {
    const result = buildScriptTxtImportPreview({
      projectId: "p-limit",
      fileName: "large.txt",
      bytes: encoder.encode("文".repeat(SCRIPT_UPLOAD_MAX_CHARS + 1)),
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.code).toBe("CHARACTER_LIMIT_EXCEEDED");
      expect(result.message).toContain("10 万字");
    }
  });

  it("rejects oversized Markdown after normalization", () => {
    const result = buildScriptMarkdownImportPreview({
      projectId: "p-limit",
      fileName: "large.md",
      bytes: encoder.encode("文".repeat(SCRIPT_UPLOAD_MAX_CHARS + 1)),
      mimeType: "text/markdown",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.code).toBe("CHARACTER_LIMIT_EXCEEDED");
      expect(result.message).toContain("10 万字");
    }
  });

  it("shows the limit reminder for script and novel upload", () => {
    const root = process.cwd();
    const scriptPanel = readFileSync(
      path.join(root, "src/projects/script/ScriptUploadPanel.tsx"),
      "utf8",
    );
    const novelPanel = readFileSync(
      path.join(root, "src/projects/script/NovelToScriptPanel.tsx"),
      "utf8",
    );

    expect(scriptPanel).toContain("剧本内容最多");
    expect(novelPanel).toContain("小说内容最多");
    expect(scriptPanel).toContain("SCRIPT_UPLOAD_MAX_CHARS_LABEL");
    expect(novelPanel).toContain("SCRIPT_UPLOAD_MAX_CHARS_LABEL");
  });
});