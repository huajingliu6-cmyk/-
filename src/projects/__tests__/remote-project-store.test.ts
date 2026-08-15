import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  projects: [] as Array<Record<string, unknown>>,
  revision: 0,
  calls: [] as Array<{ path: string; init?: RequestInit }>,
}));

vi.mock("@/persistence/remote-data-client", () => ({
  requestRemoteData: vi.fn(async (path: string, init?: RequestInit) => {
    api.calls.push({ path, init });
    if (path === "/v1/projects" && (!init?.method || init.method === "GET")) {
      return Response.json({ projects: api.projects, revision: api.revision });
    }
    if (path === "/v1/projects" && init?.method === "POST") {
      const input = JSON.parse(String(init.body));
      const project = {
        projectId: "p_remote",
        rootFolderId: "p_remote",
        name: input.name,
        ownerId: new Headers(init.headers).get("x-actor-id"),
        creationSource: input.creationSource,
        projectMode: input.projectMode,
        status: "draft",
        highlights: input.highlights ?? "",
        approvalEnabled: input.approvalEnabled === true,
        passwordEnabled: input.passwordEnabled,
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
      };
      api.projects.push({ ...project, passwordHash: "hash", passwordSalt: "salt" });
      api.revision += 1;
      return Response.json({ project, reused: false }, { status: 201 });
    }
    if (path.startsWith("/v1/projects/by-idempotency/")) {
      return new Response(null, { status: 404 });
    }
    const projectId = decodeURIComponent(path.slice("/v1/projects/".length));
    const project = api.projects.find((entry) => entry.projectId === projectId);
    if (!project) return new Response(null, { status: 404 });
    if (init?.method === "PATCH") {
      const input = JSON.parse(String(init.body));
      Object.assign(project, {
        highlights: input.highlights.trim(),
        updatedAt: "2026-08-02T00:01:00.000Z",
      });
    }
    return Response.json({ project });
  }),
}));

import {
  createProjectRecordRemote,
  getProjectRecordRemote,
  listProjectRecordsRemote,
  updateProjectHighlightsRemote,
} from "@/projects/remote-project-store";

describe("remote project store", () => {
  beforeEach(() => {
    api.projects = [];
    api.revision = 0;
    api.calls = [];
  });

  it("creates projects through the dedicated Go API", async () => {
    const project = await createProjectRecordRemote("owner-1", {
      name: "远端项目",
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: true,
      approvalEnabled: true,
      projectPassword: "secret",
    });

    expect(project).not.toHaveProperty("passwordHash");
    expect(project.approvalEnabled).toBe(true);
    expect(api.calls[0]?.path).toBe("/v1/projects");
    expect(new Headers(api.calls[0]?.init?.headers).get("x-actor-id")).toBe(
      "owner-1",
    );
  });

  it("lists and reads project records through Go", async () => {
    await createProjectRecordRemote("owner-1", {
      name: "列表项目",
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    expect(await listProjectRecordsRemote()).toHaveLength(1);
    expect((await getProjectRecordRemote("p_remote"))?.ownerId).toBe("owner-1");
  });

  it("updates highlights through the dedicated Go API", async () => {
    await createProjectRecordRemote("owner-1", {
      name: "要点项目",
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    const updated = await updateProjectHighlightsRemote("p_remote", " 新要点 ");
    expect(updated.highlights).toBe("新要点");
    expect(api.calls.at(-1)?.init?.method).toBe("PATCH");
  });
});
