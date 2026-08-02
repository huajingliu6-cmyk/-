import { describe, expect, it } from "vitest";
import { normalizeScriptDraft } from "@/projects/script/script-draft-store";

describe("script-draft-store", () => {
  it("normalizes episode drafts", () => {
    const draft = normalizeScriptDraft("p_test", {
      episodes: [
        {
          id: "ep1",
          episodeNumber: 1,
          title: "第一集",
          content: "你好",
          wordCount: 2,
          status: "saved",
        },
      ],
      selectedId: "ep1",
      sourceFile: {
        id: "f1",
        name: "a.txt",
        type: "txt",
        size: 12,
        status: "uploaded",
      },
    });
    expect(draft?.projectId).toBe("p_test");
    expect(draft?.episodes).toHaveLength(1);
    expect(draft?.episodes[0]?.title).toBe("第一集");
    expect(draft?.sourceFile?.name).toBe("a.txt");
    expect(draft?.selectedId).toBe("ep1");
    expect(draft?.sourceImport).toBeNull();
    expect(draft?.sourceText).toBeNull();
  });

  it("normalizes sourceImport and sourceText", () => {
    const draft = normalizeScriptDraft("p_test", {
      sourceText: "第1集\n正文",
      preambleNotes: "前言",
      sourceImport: {
        format: "txt",
        fileName: "C:\\\\Users\\\\x\\\\a.txt",
        mimeType: "text/plain",
        byteLength: 12,
        sha256: "a".repeat(64),
        encoding: "utf-8",
        importedAt: "2026-07-28T00:00:00.000Z",
      },
      episodes: [],
    });
    expect(draft?.sourceText).toContain("正文");
    expect(draft?.preambleNotes).toBe("前言");
    expect(draft?.sourceImport?.fileName).toBe("a.txt");
    expect(draft?.sourceImport?.format).toBe("txt");
  });

  it("infers format=txt for legacy sourceImport without format", () => {
    const draft = normalizeScriptDraft("p_test", {
      sourceImport: {
        fileName: "a.txt",
        mimeType: "text/plain",
        byteLength: 3,
        sha256: "b".repeat(64),
        encoding: "utf-8",
        importedAt: "2026-07-28T00:00:00.000Z",
      },
      episodes: [],
    });
    expect(draft?.sourceImport?.format).toBe("txt");
  });

  it("accepts docx sourceImport without encoding", () => {
    const draft = normalizeScriptDraft("p_test", {
      sourceImport: {
        format: "docx",
        fileName: "a.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteLength: 100,
        sha256: "c".repeat(64),
        importedAt: "2026-07-28T00:00:00.000Z",
      },
      episodes: [],
    });
    expect(draft?.sourceImport?.format).toBe("docx");
    expect(draft?.sourceImport?.encoding).toBeUndefined();
  });
});
