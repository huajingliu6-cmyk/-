import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StoredDocument = { revision: number; value: unknown };

const documents = vi.hoisted(() => new Map<string, StoredDocument>());
const atomicConflicts = vi.hoisted(() => ({ remaining: 0 }));




vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    const projectId = url.searchParams.get("projectId");
    if ((init.method ?? "GET") === "POST" && projectId) {
      const body = JSON.parse(String(init.body)) as {
        expectedRevision: number;
        workflow: Record<string, unknown>;
      };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const current = documents.get(`workflow-documents/${projectId}`);
        const index = documents.get("workflow-index/all");
        const projectIds = [
          ...new Set(
            ((index?.value as { projectIds?: string[] } | undefined)?.projectIds ?? []),
          ),
        ];
        if (projectIds.includes(projectId)) {
          if (body.expectedRevision !== (current?.revision ?? 0)) {
            return Response.json({ error: "workflow revision conflict" }, { status: 409 });
          }
          const revision = (current?.revision ?? 0) + 1;
          documents.set(`workflow-documents/${projectId}`, {
            revision,
            value: structuredClone(body.workflow),
          });
          return Response.json({ workflow: body.workflow, revision });
        }
        if (atomicConflicts.remaining > 0) {
          atomicConflicts.remaining -= 1;
          documents.set("workflow-index/all", {
            revision: (index?.revision ?? 0) + 1,
            value: {
              version: 1,
              projectIds: [...projectIds, "concurrent_project"],
              updatedAt: new Date().toISOString(),
            },
          });
          await Promise.resolve();
          continue;
        }
        const latest = documents.get(`workflow-documents/${projectId}`);
        if (body.expectedRevision !== (latest?.revision ?? 0)) {
          return Response.json({ error: "workflow revision conflict" }, { status: 409 });
        }
        const latestIndex = documents.get("workflow-index/all");
        const latestProjectIds = [
          ...new Set(
            ((latestIndex?.value as { projectIds?: string[] } | undefined)?.projectIds ?? []),
          ),
        ];
        const revision = (latest?.revision ?? 0) + 1;
        documents.set(`workflow-documents/${projectId}`, {
          revision,
          value: structuredClone(body.workflow),
        });
        documents.set("workflow-index/all", {
          revision: (latestIndex?.revision ?? 0) + 1,
          value: {
            version: 1,
            projectIds: [...latestProjectIds, projectId],
            updatedAt: new Date().toISOString(),
          },
        });
        return Response.json({ workflow: body.workflow, revision });
      }
      return Response.json({ error: "workflow index write conflict" }, { status: 409 });
    }
    if (projectId) {
      const document = documents.get(`workflow-documents/${projectId}`);
      return Response.json({
        workflow: structuredClone(document?.value ?? null),
        revision: document?.revision ?? 0,
      });
    }
    const index = documents.get("workflow-index/all")?.value as
      | { projectIds?: string[] }
      | undefined;
    const listed = (index?.projectIds ?? []).flatMap((id) => {
      const document = documents.get(`workflow-documents/${id}`);
      if (!document) return [];
      const value = structuredClone(document.value);
      if (!value || typeof value !== "object" || (value as { projectId?: unknown }).projectId !== id) {
        return [];
      }
      return [{ projectId: id, value, revision: document.revision }];
    });
    return Response.json({ documents: listed });
  }),
}));
import { createDefaultWorkflow } from "@/workflow/default-workflow";
import {
  listWorkflowSummaries,
  loadWorkflow,
  saveWorkflow,
} from "@/workflow/lib/workflow-storage";

describe("remote workflow storage", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-workflow-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    documents.clear();
    atomicConflicts.remaining = 0;
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("atomically creates a workflow and its list index", async () => {
    const initial = await loadWorkflow("project_1");
    expect(documents.size).toBe(0);
    const saved = await saveWorkflow({
      ...initial,
      viewport: { x: 10, y: 20, zoom: 1.2 },
    });

    expect(saved.revision).toBe(1);
    expect(documents.has("workflow-documents/project_1")).toBe(true);
    expect(documents.get("workflow-index/all")?.value).toMatchObject({
      projectIds: ["project_1"],
    });
    expect((await loadWorkflow("project_1")).viewport).toEqual({
      x: 10,
      y: 20,
      zoom: 1.2,
    });
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("rejects a stale whole-document save", async () => {
    const initial = await loadWorkflow("project_1");
    await saveWorkflow(initial);
    const firstCopy = await loadWorkflow("project_1");
    const staleCopy = structuredClone(firstCopy);

    await saveWorkflow({
      ...firstCopy,
      viewport: { x: 30, y: 40, zoom: 1 },
    });

    await expect(
      saveWorkflow({
        ...staleCopy,
        viewport: { x: 90, y: 90, zoom: 2 },
      }),
    ).rejects.toThrow("REVISION_CONFLICT");
    expect((await loadWorkflow("project_1")).viewport.x).toBe(30);
  });

  it("uses the public workflow revision when the API payload has no remote symbol", async () => {
    await saveWorkflow(await loadWorkflow("project_1"));
    const apiPayload = JSON.parse(JSON.stringify(await loadWorkflow("project_1")));

    const saved = await saveWorkflow({
      ...apiPayload,
      viewport: { x: 12, y: 24, zoom: 1.1 },
    });

    expect(saved.revision).toBe(2);
    expect((await loadWorkflow("project_1")).viewport.x).toBe(12);
  });

  it("retries an index-only conflict without overwriting a concurrent workflow", async () => {
    documents.set("workflow-documents/project_1", {
      revision: 1,
      value: { ...createDefaultWorkflow("project_1"), revision: 1 },
    });
    atomicConflicts.remaining = 1;
    const loaded = await loadWorkflow("project_1");

    const saved = await saveWorkflow({
      ...loaded,
      viewport: { x: 45, y: 55, zoom: 1.25 },
    });

    expect(saved.revision).toBe(2);
    expect(documents.get("workflow-index/all")?.value).toMatchObject({
      projectIds: ["concurrent_project", "project_1"],
    });
  });

  it("lists isolated project summaries and skips a missing indexed document", async () => {
    await saveWorkflow(createDefaultWorkflow("project_1"));
    await saveWorkflow(createDefaultWorkflow("project_2"));
    const index = documents.get("workflow-index/all")!;
    documents.set("workflow-index/all", {
      revision: index.revision + 1,
      value: {
        ...(index.value as object),
        projectIds: ["project_1", "missing", "corrupt", "project_2"],
      },
    });
    documents.set("workflow-documents/corrupt", {
      revision: 1,
      value: { projectId: "another_project", revision: 0 },
    });

    expect((await listWorkflowSummaries()).map((item) => item.projectId).sort()).toEqual([
      "project_1",
      "project_2",
    ]);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
