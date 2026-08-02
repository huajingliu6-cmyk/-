import { describe, expect, it } from "vitest";
import {
  scriptDraftContentChanged,
  scriptDraftContentFingerprint,
} from "@/projects/script/script-content-fingerprint";
import type { ScriptDraft } from "@/projects/script/script-draft-store";
import type { ScriptEpisode } from "@/projects/script/types";

function ep(
  n: number,
  title: string,
  content: string,
): ScriptEpisode {
  return {
    id: `ep_${n}`,
    projectId: "p1",
    episodeNumber: n,
    title,
    content,
    wordCount: content.length,
    status: "saved",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function draft(
  partial: Partial<ScriptDraft> & {
    episodes: ScriptEpisode[];
    sourceText: string;
  },
): ScriptDraft {
  return {
    projectId: "p1",
    sourceFile: null,
    preambleNotes: null,
    sourceImport: null,
    novelTask: {
      id: "nt",
      projectId: "p1",
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    selectedId: null,
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 1,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("script content fingerprint cross-format", () => {
  const sourceText = "第一集：开端\n正文A\n\n第2集：冲突\n正文B";
  const episodes = [
    ep(1, "第1集：开端", "正文A"),
    ep(2, "第2集：冲突", "正文B"),
  ];

  it("TXT and DOCX same semantic content share fingerprint", () => {
    const txt = draft({
      sourceText,
      episodes,
      sourceImport: {
        format: "txt",
        fileName: "a.txt",
        mimeType: "text/plain",
        byteLength: 10,
        sha256: "a".repeat(64),
        encoding: "utf-8",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const docx = draft({
      sourceText,
      episodes,
      sourceImport: {
        format: "docx",
        fileName: "b.docx",
        mimeType: null,
        byteLength: 99,
        sha256: "b".repeat(64),
        importedAt: "2026-06-01T00:00:00.000Z",
      },
    });
    expect(scriptDraftContentFingerprint(txt)).toBe(
      scriptDraftContentFingerprint(docx),
    );
    expect(scriptDraftContentChanged(txt, docx)).toBe(false);
  });

  it("filename-only change does not invalidate", () => {
    const a = draft({
      sourceText,
      episodes,
      sourceImport: {
        format: "docx",
        fileName: "old.docx",
        mimeType: null,
        byteLength: 1,
        sha256: "c".repeat(64),
        importedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const b = draft({
      sourceText,
      episodes,
      sourceImport: {
        format: "docx",
        fileName: "new.docx",
        mimeType: null,
        byteLength: 1,
        sha256: "d".repeat(64),
        importedAt: "2026-02-01T00:00:00.000Z",
      },
    });
    expect(scriptDraftContentChanged(a, b)).toBe(false);
  });

  it("body or order change does invalidate", () => {
    const base = draft({ sourceText, episodes });
    expect(
      scriptDraftContentChanged(base, {
        sourceText: sourceText + "改",
        preambleNotes: null,
        episodes,
      }),
    ).toBe(true);
    expect(
      scriptDraftContentChanged(base, {
        sourceText,
        preambleNotes: null,
        episodes: [episodes[1]!, episodes[0]!],
      }),
    ).toBe(true);
  });
});
