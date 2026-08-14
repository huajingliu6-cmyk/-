import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
  saveScriptDraft,
} from "@/projects/script/script-draft-store";
import { episodeContentFingerprint } from "@/projects/script/script-split-reconstruct";
import type { ProposedEpisode } from "@/projects/script/script-split-types";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { POST as confirmSplit } from "@/app/api/projects/[projectId]/script-draft/confirm-split/route";

function auth(id: string, username = id): AuthUser {
  return {
    id,
    username,
    role: "user",
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function confirmRequest(
  projectId: string,
  body: Record<string, unknown>,
) {
  return new Request(
    `http://localhost/api/projects/${projectId}/script-draft/confirm-split`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function proposedFromSource(
  sourceText: string,
  titles: [string, string],
): ProposedEpisode[] {
  const ep1Text = "Alpha block.\n\nBeta block.";
  const ep2Text = "Gamma block.\n\nDelta block.";
  void sourceText;
  return [
    {
      id: "ep_split_1",
      episodeNumber: 1,
      title: titles[0],
      text: ep1Text,
      contentFingerprint: episodeContentFingerprint(ep1Text),
    },
    {
      id: "ep_split_2",
      episodeNumber: 2,
      title: titles[1],
      text: ep2Text,
      contentFingerprint: episodeContentFingerprint(ep2Text),
    },
  ];
}

describe("script confirm-split route", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-script-split-confirm-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function seedReviewDraft(projectId: string, sourceText: string) {
    const fingerprint = getScriptSourceFingerprint(sourceText)!;
    const proposed = proposedFromSource(sourceText, ["上", "下"]);
    await saveScriptDraft({
      projectId,
      sourceText,
      episodes: [],
      episodeSplit: {
        status: "review",
        sourceFingerprint: fingerprint,
        generationId: "tg_test",
        proposedEpisodes: proposed,
        generatedAt: "2026-07-28T00:00:00.000Z",
        confirmedAt: null,
        confirmedRevision: 0,
        errorMessage: null,
      },
      novelTask: {
        id: `novel-task-${projectId}`,
        projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: "2026-07-28T00:00:00.000Z",
      },
      selectedId: null,
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 2,
        charsPerEpisode: 800,
      },
      novelOpen: false,
      sourceFile: null,
      preambleNotes: null,
      sourceImport: null,
    });
    return { fingerprint, proposed };
  }

  it("proposed episodes are not written until confirm", async () => {
    const owner = auth("owner-split-1");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "split-test",
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const sourceText =
      "Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta block.";
    await seedReviewDraft(project.projectId, sourceText);

    const before = await loadScriptDraft(project.projectId);
    expect(before?.episodes).toHaveLength(0);
    expect(before?.episodeSplit?.status).toBe("review");
    expect(before?.episodeSplit?.proposedEpisodes).toHaveLength(2);
  });

  it("confirm writes formal episodes", async () => {
    const owner = auth("owner-split-2");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "split-test-2",
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const sourceText =
      "Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta block.";
    const { fingerprint } = await seedReviewDraft(project.projectId, sourceText);

    const res = await confirmSplit(
      confirmRequest(project.projectId, {
        sourceFingerprint: fingerprint,
        confirmedRevision: 0,
        idempotencyKey: "idem-1",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { episodes: unknown[] } };
    expect(body.draft.episodes).toHaveLength(2);

    const after = await loadScriptDraft(project.projectId);
    expect(after?.episodeSplit?.status).toBe("confirmed");
    expect(after?.episodes[0]?.title).toBe("上");
    expect(after?.episodes[0]?.content).toContain("Alpha block.");
  });

  it("rejects wrong fingerprint", async () => {
    const owner = auth("owner-split-3");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "split-test-3",
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const sourceText =
      "Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta block.";
    await seedReviewDraft(project.projectId, sourceText);

    const res = await confirmSplit(
      confirmRequest(project.projectId, {
        sourceFingerprint: "deadbeef".repeat(8),
        confirmedRevision: 0,
        idempotencyKey: "idem-2",
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(res.status).toBe(409);
    const after = await loadScriptDraft(project.projectId);
    expect(after?.episodes).toHaveLength(0);
  });

  it("idempotent confirm with same idempotency key", async () => {
    const owner = auth("owner-split-4");
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });
    const project = await createProjectRecord(owner.id, {
      name: "split-test-4",
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const sourceText =
      "Alpha block.\n\nBeta block.\n\nGamma block.\n\nDelta block.";
    const { fingerprint } = await seedReviewDraft(project.projectId, sourceText);

    const payload = {
      sourceFingerprint: fingerprint,
      confirmedRevision: 0,
      idempotencyKey: "idem-repeat",
    };
    const first = await confirmSplit(
      confirmRequest(project.projectId, payload),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(first.status).toBe(200);

    const second = await confirmSplit(
      confirmRequest(project.projectId, {
        ...payload,
        confirmedRevision: 1,
      }),
      { params: Promise.resolve({ projectId: project.projectId }) },
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { idempotent: boolean };
    expect(body.idempotent).toBe(true);
  });
});
