import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredDocument = { revision: number; value: unknown };

const documents = vi.hoisted(() => new Map<string, StoredDocument>());
const state = vi.hoisted(() => ({ conflictsRemaining: 0 }));
const atomicWrites = vi.hoisted(() => vi.fn());

vi.mock("@/persistence/remote-data-client", () => ({
  requestRemoteData: vi.fn(async (requestPath: string) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    let identity = "";
    if (url.pathname === "/v1/project-asset-data") {
      const namespace = {
        bundle: "asset-bundles",
        "episode-designs": "episode-asset-designs",
        approvals: "asset-approvals",
      }[url.searchParams.get("kind") ?? ""];
      identity = `${namespace}/${url.searchParams.get("projectId") ?? ""}`;
      const document = documents.get(identity);
      return Response.json({
        value: structuredClone(document?.value ?? null),
        revision: document?.revision ?? 0,
      });
    }
    if (url.pathname === "/v1/workspace-data") {
      const namespace = {
        snapshot: "workspace-snapshots",
        assets: "workspace-assets",
        "episode-designs": "workspace-episode-asset-designs",
      }[url.searchParams.get("kind") ?? ""];
      identity = `${namespace}/${url.searchParams.get("projectId") ?? ""}`;
      const document = documents.get(identity);
      return Response.json({
        value: structuredClone(document?.value ?? null),
        revision: document?.revision ?? 0,
      });
    }
    if (url.pathname === "/v1/script-drafts") {
      const projectId = url.searchParams.get("projectId") ?? "";
      const document = documents.get(`script-drafts/${projectId}`);
      return Response.json({
        draft: structuredClone(document?.value ?? null),
      });
    }
    if (url.pathname === "/v1/notifications") {
      identity = `notifications/${url.searchParams.get("userId") ?? ""}`;
      const document = documents.get(identity);
      return Response.json({
        file: structuredClone(
          document?.value ?? { version: 1, notifications: [] },
        ),
        revision: document?.revision ?? 0,
      });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }),  isRemoteDataOnly: () => true,
  getRemoteDocument: vi.fn(async (namespace: string, key: string) => {
    const document = documents.get(`${namespace}/${key}`);
    return document
      ? {
          namespace,
          key,
          revision: document.revision,
          value: structuredClone(document.value),
          updatedAt: new Date().toISOString(),
        }
      : null;
  }),
  putRemoteDocument: vi.fn(
    async (input: {
      namespace: string;
      key: string;
      expectedRevision?: number;
      value: unknown;
    }) => {
      const identity = `${input.namespace}/${input.key}`;
      const current = documents.get(identity);
      const expected = input.expectedRevision ?? 0;
      if ((current?.revision ?? 0) !== expected) {
        throw new Error("REVISION_CONFLICT");
      }
      const revision = (current?.revision ?? 0) + 1;
      documents.set(identity, {
        revision,
        value: structuredClone(input.value),
      });
      return {
        namespace: input.namespace,
        key: input.key,
        revision,
        value: structuredClone(input.value),
        updatedAt: new Date().toISOString(),
      };
    },
  ),
  putRemoteDocumentsAtomic: atomicWrites.mockImplementation(
    async (input: {
      writes: Array<{
        namespace: string;
        key: string;
        expectedRevision: number;
        value: unknown;
      }>;
    }) => {
      if (state.conflictsRemaining > 0) {
        state.conflictsRemaining -= 1;
        const identity = "asset-bundles/project_1";
        const current = documents.get(identity)!;
        documents.set(identity, {
          revision: current.revision + 1,
          value: structuredClone(current.value),
        });
        throw new Error("REVISION_CONFLICT");
      }
      for (const write of input.writes) {
        const current = documents.get(`${write.namespace}/${write.key}`);
        if (write.expectedRevision !== (current?.revision ?? 0)) {
          throw new Error("REVISION_CONFLICT");
        }
      }
      const result = input.writes.map((write) => {
        const identity = `${write.namespace}/${write.key}`;
        const current = documents.get(identity);
        const next = {
          revision: (current?.revision ?? 0) + 1,
          value: structuredClone(write.value),
        };
        documents.set(identity, next);
        return {
          namespace: write.namespace,
          key: write.key,
          revision: next.revision,
          value: structuredClone(next.value),
          updatedAt: new Date().toISOString(),
        };
      });
      return { documents: result };
    },
  ),
  isRemoteRevisionConflict: (error: unknown) =>
    error instanceof Error && error.message === "REVISION_CONFLICT",
}));

vi.mock("@/projects/assets/remote-transaction-client", () => ({
  runProjectAssetTransaction: atomicWrites,
}));
import { confirmEpisodeAssetDesign } from "@/projects/assets/episode-design/confirm";

const fingerprint = "fingerprint_1";
let isolatedRoot = "";

function seed() {
  documents.set("episode-asset-designs/project_1", {
    revision: 1,
    value: {
      projectId: "project_1",
      updatedAt: "2026-08-01T00:00:00.000Z",
      records: [
        {
          episodeId: "episode_1",
          episodeNumber: 1,
          status: "review",
          revision: 1,
          contentFingerprint: fingerprint,
          generationId: null,
          items: [
            {
              id: "item_1",
              assetType: "prop",
              name: "雨伞",
              resolution: "create_new",
              source: "ai",
              draft: {
                description: "黑色雨伞",
                propType: "道具",
                usage: "雨中场景",
                usageInEpisode: "开场",
                evidence: "剧本",
              },
              generatedMedia: {
                currentId: "gen_prop_remote_1",
                historyIds: ["gen_prop_remote_1"],
                status: "completed",
                promptFingerprint: null,
                errorMessage: null,
                mimeType: "image/png",
                previewKind: "image",
              },
            },
          ],
          confirmedAt: null,
          confirmedBy: null,
          confirmedRevision: null,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    },
  });
  documents.set("asset-bundles/project_1", {
    revision: 1,
    value: {
      projectId: "project_1",
      characters: [],
      scenes: [],
      props: [],
      audios: [],
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  });
}

describe("remote episode asset design confirmation", () => {
  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-confirm-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    documents.clear();
    state.conflictsRemaining = 0;
    atomicWrites.mockClear();
    seed();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("atomically confirms the design and creates its library asset", async () => {
    const result = await confirmEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "owner_1",
      fingerprint,
    });

    expect(result.ok).toBe(true);
    expect(atomicWrites).toHaveBeenCalledTimes(1);
    const writes = atomicWrites.mock.calls[0]?.[0].writes ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.map((write: { namespace: string }) => write.namespace)).toEqual(
      expect.arrayContaining(["episode-asset-designs", "asset-bundles"]),
    );
    const design = documents.get("episode-asset-designs/project_1")?.value as {
      records: Array<{ status: string; items: Array<{ libraryAssetId?: string }> }>;
    };
    const assets = documents.get("asset-bundles/project_1")?.value as {
      props: Array<{ id: string; name: string }>;
    };
    expect(design.records[0]?.status).toBe("confirmed");
    expect(assets.props).toHaveLength(1);
    expect(design.records[0]?.items[0]?.libraryAssetId).toBe(assets.props[0]?.id);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("reloads both documents and retries after a CAS conflict", async () => {
    state.conflictsRemaining = 1;

    const result = await confirmEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "owner_1",
      fingerprint,
    });

    expect(result.ok).toBe(true);
    expect(atomicWrites.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(documents.get("asset-bundles/project_1")?.revision).toBe(3);
  });

  it("atomically confirms one design item without confirming the record", async () => {
    const result = await confirmEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "owner_1",
      fingerprint,
      itemId: "item_1",
    });

    expect(result.ok).toBe(true);
    expect(atomicWrites).toHaveBeenCalledTimes(1);
    const design = documents.get("episode-asset-designs/project_1")?.value as {
      records: Array<{ status: string; items: Array<{ libraryAssetId?: string }> }>;
    };
    expect(design.records[0]?.status).toBe("review");
    expect(design.records[0]?.items[0]?.libraryAssetId).toBeTruthy();
  });

  it("is idempotent when the same revision is already confirmed", async () => {
    const first = await confirmEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "owner_1",
      fingerprint,
    });
    const second = await confirmEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "episode_1",
      expectedRevision: 1,
      userId: "owner_1",
      fingerprint,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(atomicWrites).toHaveBeenCalledTimes(1);
    if (second.ok) expect(second.counts.created).toBe(0);
  });

  it("does not write when the design record is missing", async () => {
    documents.delete("episode-asset-designs/project_1");

    const result = await confirmEpisodeAssetDesign({
      projectId: "project_1",
      episodeId: "missing",
      expectedRevision: 1,
      userId: "owner_1",
      fingerprint,
    });

    expect(result).toMatchObject({ ok: false, code: "EPISODE_DESIGN_NOT_FOUND" });
    expect(atomicWrites).not.toHaveBeenCalled();
  });
});
