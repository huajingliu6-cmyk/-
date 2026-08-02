import { beforeEach, describe, expect, it, vi } from "vitest";

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
  putRemoteDocument: vi.fn(),
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
        const identity = "notifications/owner_1";
        const current = documents.get(identity);
        documents.set(identity, {
          revision: (current?.revision ?? 0) + 1,
          value: {
            version: 1,
            notifications: [
              {
                id: "ntf_concurrent",
                recipientUserId: "owner_1",
                type: "asset_approval_rejected",
                projectId: "project_other",
                episodeId: "episode_other",
                submissionId: "submission_other",
                submitterUserId: "user_other",
                title: "concurrent",
                summary: "concurrent",
                createdAt: "2026-08-01T00:00:00.000Z",
                readAt: null,
              },
            ],
          },
        });
        throw new Error("REVISION_CONFLICT");
      }
      for (const write of input.writes) {
        const identity = `${write.namespace}/${write.key}`;
        const current = documents.get(identity);
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

vi.mock("@/projects/project-access", () => ({
  getProjectRecord: vi.fn(async () => ({
    id: "project_1",
    ownerId: "owner_1",
    name: "Project",
  })),
}));

vi.mock("@/projects/workspace-sync/workspace-episode-design-api", () => ({
  getWorkspaceEpisodeAssetDesignDetail: vi.fn(async () => ({
    ok: true,
    record: {
      episodeNumber: 1,
      items: [{ id: "design_1", assetType: "scene", name: "Scene" }],
    },
  })),
}));

vi.mock("@/projects/assets/approvals/candidates", () => ({
  listApprovalCandidates: vi.fn(async () => ({
    ok: true,
    candidates: [
      {
        generatedMediaId: "media_1",
        assetDesignItemId: "design_1",
        category: "scene",
        assetName: "Scene",
        generatedAt: "2026-08-01T00:00:00.000Z",
        prompt: "prompt",
        status: "submittable",
        submissionId: null,
      },
    ],
  })),
  findCandidateByMediaId: (
    candidates: Array<{ generatedMediaId: string }>,
    mediaId: string,
  ) => candidates.find((candidate) => candidate.generatedMediaId === mediaId),
}));

vi.mock("@/projects/assets/remote-transaction-client", () => ({
  runProjectAssetTransaction: atomicWrites,
}));
import { submitAssetApproval } from "@/projects/assets/approvals/submit";

function submit(idempotencyKey: string) {
  return submitAssetApproval({
    projectId: "project_1",
    episodeId: "episode_1",
    generatedMediaIds: ["media_1"],
    submittedByUserId: "engineer_1",
    idempotencyKey,
  });
}

describe("remote asset approval submit", () => {
  beforeEach(() => {
    documents.clear();
    state.conflictsRemaining = 0;
    atomicWrites.mockClear();
  });

  it("atomically writes the approval and owner notification documents", async () => {
    const result = await submit("submit_1");

    expect(result).toMatchObject({ ok: true, reused: false });
    expect(atomicWrites).toHaveBeenCalledTimes(1);
    const approvals = documents.get("asset-approvals/project_1")?.value as {
      submissions: unknown[];
    };
    const notifications = documents.get("notifications/owner_1")?.value as {
      notifications: unknown[];
    };
    expect(approvals.submissions).toHaveLength(1);
    expect(notifications.notifications).toHaveLength(1);
  });

  it("reuses an existing idempotent submission without another transaction", async () => {
    const first = await submit("submit_1");
    const second = await submit("submit_1");

    expect(first).toMatchObject({ ok: true, reused: false });
    expect(second).toMatchObject({ ok: true, reused: true });
    expect(atomicWrites).toHaveBeenCalledTimes(1);
  });

  it("reloads both documents after conflict and preserves concurrent notifications", async () => {
    state.conflictsRemaining = 1;

    const result = await submit("submit_1");

    expect(result).toMatchObject({ ok: true, reused: false });
    expect(atomicWrites).toHaveBeenCalledTimes(2);
    const notifications = documents.get("notifications/owner_1")?.value as {
      notifications: Array<{ id: string }>;
    };
    expect(notifications.notifications.map((item) => item.id)).toContain(
      "ntf_concurrent",
    );
    expect(notifications.notifications).toHaveLength(2);
  });
});
