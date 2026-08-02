import type { ProjectRecord } from "@/projects/types";

const state: { projects: ProjectRecord[]; sequence: number; revision: number } = {
  projects: [],
  sequence: 0,
  revision: 0,
};

export function resetInMemoryProjectApi() {
  state.projects = [];
  state.sequence = 0;
  state.revision = 0;
}

export async function requestInMemoryProjectApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  if (path === "/v1/projects" && method === "GET") {
    return Response.json({ projects: state.projects, revision: state.revision });
  }
  if (path === "/v1/projects" && method === "POST") {
    const input = JSON.parse(String(init.body)) as {
      name: string;
      creationSource: ProjectRecord["creationSource"];
      projectMode: ProjectRecord["projectMode"];
      highlights?: string;
      passwordEnabled: boolean;
    };
    const now = new Date(1_800_000_000_000 + state.sequence * 1_000).toISOString();
    const projectId = `test-project-${++state.sequence}`;
    const project: ProjectRecord = {
      projectId,
      rootFolderId: projectId,
      name: input.name.trim(),
      ownerId: new Headers(init.headers).get("x-actor-id") ?? "",
      creationSource: input.creationSource,
      projectMode: input.projectMode,
      status: "draft",
      highlights: input.highlights?.trim() ?? "",
      passwordEnabled: input.passwordEnabled,
      passwordHash: null,
      passwordSalt: null,
      createdAt: now,
      updatedAt: now,
    };
    state.projects.push(project);
    state.revision += 1;
    return Response.json({ project, reused: false }, { status: 201 });
  }
  if (path.startsWith("/v1/projects/by-idempotency/")) {
    return new Response(null, { status: 404 });
  }
  if (path.startsWith("/v1/projects/")) {
    const projectId = decodeURIComponent(path.slice("/v1/projects/".length));
    const project = state.projects.find((entry) => entry.projectId === projectId);
    if (!project) return new Response(null, { status: 404 });
    if (method === "PATCH") {
      const input = JSON.parse(String(init.body)) as { highlights: string };
      project.highlights = input.highlights.trim();
      project.updatedAt = new Date(1_800_000_000_000 + state.sequence * 1_000 + state.revision).toISOString();
      state.revision += 1;
    }
    return Response.json({ project });
  }
  return Response.json({ error: "unsupported test request" }, { status: 501 });
}
