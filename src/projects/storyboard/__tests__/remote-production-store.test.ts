import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredDocument = { revision: number; value: unknown };
const documents = vi.hoisted(() => new Map<string, StoredDocument>());

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    const projectId = url.searchParams.get("projectId") ?? "";
    if ((init.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init.body)) as {
        expectedRevision: number;
        workspace: Record<string, unknown>;
      };
      const current = documents.get(projectId);
      if (body.expectedRevision !== (current?.revision ?? 0)) {
        return Response.json(
          { error: "storyboard production revision conflict" },
          { status: 409 },
        );
      }
      const workspace = {
        ...body.workspace,
        updatedAt: new Date().toISOString(),
      };
      const revision = (current?.revision ?? 0) + 1;
      documents.set(projectId, {
        revision,
        value: structuredClone(workspace),
      });
      return Response.json({ workspace, revision });
    }
    const document = documents.get(projectId);
    return Response.json({
      workspace: structuredClone(document?.value ?? null),
      revision: document?.revision ?? 0,
    });
  }),
}));
import {
  loadWorkspace,
  saveWorkspace,
  storyboardRemoteRevision,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";

const episode = {
  id: "episode_1",
  projectId: "project_1",
  episodeNumber: 1,
  title: "第一集",
  content: "开场",
  wordCount: 2,
  status: "saved" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("remote storyboard production store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-storyboard-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    documents.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("round-trips the workspace without local files", async () => {
    const initial = ensureEpisodeProductions("project_1", [episode], null);
    const saved = await saveWorkspace(initial);
    const loaded = await loadWorkspace("project_1");

    expect(saved.productions).toHaveLength(1);
    expect(loaded?.productions[0]?.episodeId).toBe("episode_1");
    expect(storyboardRemoteRevision(loaded!)).toBe(1);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("preserves the document revision through ensure and object spreads", async () => {
    await saveWorkspace(ensureEpisodeProductions("project_1", [episode], null));
    const loaded = await loadWorkspace("project_1");
    const ensured = ensureEpisodeProductions("project_1", [episode], loaded);
    const saved = await saveWorkspace({ ...ensured, activeEpisodeId: "episode_1" });

    expect(storyboardRemoteRevision(ensured)).toBe(1);
    expect(storyboardRemoteRevision(saved)).toBe(2);
  });

  it("rejects a stale whole-document save instead of overwriting", async () => {
    await saveWorkspace(ensureEpisodeProductions("project_1", [episode], null));
    const first = await loadWorkspace("project_1");
    const stale = await loadWorkspace("project_1");
    await saveWorkspace({ ...first!, activeEpisodeId: "episode_1" });

    await expect(
      saveWorkspace({ ...stale!, activeEpisodeId: null }),
    ).rejects.toThrow("REVISION_CONFLICT");
  });
});
