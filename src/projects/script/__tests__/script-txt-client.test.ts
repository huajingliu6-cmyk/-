import { describe, expect, it } from "vitest";
import {
  buildSourceImportFromPreview,
  validateScriptImportFileClient,
  validateScriptTxtFileClient,
} from "@/projects/script/script-txt-client";
import { SCRIPT_TXT_MAX_BYTES } from "@/projects/script/script-txt-constants";
import { scriptDraftContentChanged } from "@/projects/script/script-content-fingerprint";
import type { ScriptDraft } from "@/projects/script/script-draft-store";

describe("script-txt-client helpers", () => {
  it("rejects non-txt / empty / oversize on client", () => {
    expect(
      validateScriptTxtFileClient(
        new File([new Uint8Array([0x78])], "a.docx", { type: "text/plain" }),
      ),
    ).toMatch(/txt/i);
    expect(
      validateScriptTxtFileClient(
        new File([], "a.txt", { type: "text/plain" }),
      ),
    ).toMatch(/空/);
    const hugeBytes = new Uint8Array(SCRIPT_TXT_MAX_BYTES + 1);
    hugeBytes.fill(0x61);
    const huge = new File([hugeBytes], "a.txt", { type: "text/plain" });
    expect(validateScriptTxtFileClient(huge)).toMatch(/MiB|上限/);
    expect(
      validateScriptTxtFileClient(
        new File([new Uint8Array([0x6f, 0x6b])], "play.txt", {
          type: "text/plain",
        }),
      ),
    ).toBeNull();
  });

  it("builds sourceImport without paths", () => {
    const meta = buildSourceImportFromPreview({
      format: "txt",
      fileName: "a.txt",
      byteLength: 3,
      sha256: "a".repeat(64),
      encoding: "utf-8",
      mimeType: "text/plain",
      sourceText: "abc",
      preamble: "",
      episodes: [],
      warnings: [],
      episodeCount: 0,
      characterCount: 3,
    });
    expect(meta.fileName).toBe("a.txt");
    expect(meta.format).toBe("txt");
    expect(JSON.stringify(meta)).not.toMatch(/:[\\/]/);
  });

  it("builds docx sourceImport without encoding", () => {
    const meta = buildSourceImportFromPreview({
      format: "docx",
      fileName: "a.docx",
      byteLength: 3,
      sha256: "a".repeat(64),
      mimeType: null,
      sourceText: "abc",
      preamble: "",
      episodes: [],
      warnings: [],
      episodeCount: 0,
      characterCount: 3,
    });
    expect(meta.format).toBe("docx");
    expect(meta.encoding).toBeUndefined();
  });

  it("validateScriptImportFileClient accepts txt docx and markdown", () => {
    expect(
      validateScriptImportFileClient(
        new File(["x"], "a.txt", { type: "text/plain" }),
      ),
    ).toBeNull();
    expect(
      validateScriptImportFileClient(
        new File(["x"], "a.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toBeNull();
    expect(
      validateScriptImportFileClient(
        new File(["x"], "a.md", { type: "text/markdown" }),
      ),
    ).toBeNull();
    expect(
      validateScriptImportFileClient(
        new File(["x"], "a.pdf", { type: "application/pdf" }),
      ),
    ).toMatch(/不支持 PDF/);
  });

  it("builds md sourceImport with encoding", () => {
    const meta = buildSourceImportFromPreview({
      format: "md",
      fileName: "a.md",
      byteLength: 3,
      sha256: "a".repeat(64),
      encoding: "utf-8",
      mimeType: "text/markdown",
      sourceText: "abc",
      preamble: "",
      episodes: [],
      warnings: [],
      episodeCount: 0,
      characterCount: 3,
    });
    expect(meta.format).toBe("md");
    expect(meta.encoding).toBe("utf-8");
  });
});

describe("scriptDraftContentChanged", () => {
  const base = {
    episodes: [
      {
        id: "ep1",
        projectId: "p",
        episodeNumber: 1,
        title: "第1集",
        content: "正文",
        wordCount: 2,
        status: "ready" as const,
        createdAt: "t",
        updatedAt: "t",
      },
    ],
    sourceText: "第1集\n正文",
    preambleNotes: null as string | null,
  };

  it("detects content change and ignores import clock", () => {
    const prev: ScriptDraft = {
      projectId: "p",
      sourceFile: null,
      sourceText: base.sourceText,
      preambleNotes: null,
      sourceImport: {
        format: "txt",
        fileName: "a.txt",
        mimeType: "text/plain",
        byteLength: 10,
        sha256: "b".repeat(64),
        encoding: "utf-8",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
      novelTask: {
        id: "n",
        projectId: "p",
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: "t",
      },
      episodes: base.episodes,
      selectedId: "ep1",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
      updatedAt: "t",
    };
    expect(scriptDraftContentChanged(prev, base)).toBe(false);
    expect(
      scriptDraftContentChanged(prev, {
        ...base,
        sourceText: "不同",
      }),
    ).toBe(true);
  });
});
