/**
 * Session-based permission smoke (server-truth). Does not mutate roles from the client.
 * Uses cookie jar against localhost:3000.
 * Requires an isolated APP_DATA_DIR (from fixture with SMOKE_KEEP_APP_DATA_DIR=1).
 */
import { createProjectRecord } from "../src/projects/project-storage";
import {
  addCardEngineer,
  removeCardEngineer,
  listMembershipsForUser,
} from "../src/auth/project-members";
import { findUserByUsername } from "../src/auth/users";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "Smoke@123456";

type CookieJar = Map<string, string>;

function storeCookies(jar: CookieJar, res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const part = line.split(";")[0] ?? "";
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(username: string, password: string): Promise<CookieJar> {
  const jar: CookieJar = new Map();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  storeCookies(jar, res);
  const body = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(`login ${username}: ${body.error ?? res.status}`);
  return jar;
}

async function req(
  jar: CookieJar,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Cookie: cookieHeader(jar),
    },
    redirect: "manual",
  });
  storeCookies(jar, res);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* html */
  }
  return { status: res.status, json, text };
}

async function runCheck() {
  const owner = await findUserByUsername("smoke_owner");
  const engineer = await findUserByUsername("smoke_engineer");
  const sysadmin = await findUserByUsername("smoke_sysadmin");
  if (!owner || !engineer || !sysadmin) {
    throw new Error(
      "请先运行: SMOKE_KEEP_APP_DATA_DIR=1 npx tsx scripts/smoke-permission-fixture.ts，并使用相同 APP_DATA_DIR",
    );
  }

  const memberships = await listMembershipsForUser(engineer.id);
  let assignedId = memberships[0]?.projectId;
  if (!assignedId) {
    const project = await createProjectRecord(owner.id, {
      name: `Smoke Assign ${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    assignedId = project.projectId;
  }

  const other = await createProjectRecord(owner.id, {
    name: `Smoke Unassigned ${Date.now()}`,
    creationSource: "story",
    projectMode: "canvas",
    passwordEnabled: false,
  });

  const results: Array<Record<string, unknown>> = [];

  // SYSTEM_ADMIN
  const adminJar = await login("smoke_sysadmin", PASSWORD);
  const adminNav = await req(adminJar, "/api/auth/navigation");
  const adminWs = await req(adminJar, "/api/workspace/projects");
  const adminProjects = await req(adminJar, "/api/projects");
  results.push({
    role: "SYSTEM_ADMIN",
    navIds: ((adminNav.json.navigation as Array<{ id: string }>) ?? []).map(
      (n) => n.id,
    ),
    workspaceCount: Array.isArray(adminWs.json.projects)
      ? adminWs.json.projects.length
      : -1,
    managementOk: adminProjects.status === 200,
  });

  // PROJECT_OWNER
  const ownerJar = await login("smoke_owner", PASSWORD);
  const ownerWs = await req(ownerJar, "/api/workspace/projects");
  const ownerProjects = await req(ownerJar, "/api/projects");
  const ownerWsDetail = await req(
    ownerJar,
    `/api/workspace/projects/${assignedId}`,
  );
  const ownerStages = (ownerWsDetail.json.stages as Array<{ id: string }>) ?? [];
  results.push({
    role: "PROJECT_OWNER",
    workspaceIds: (
      (ownerWs.json.projects as Array<{ projectId: string }>) ?? []
    ).map((p) => p.projectId),
    managementCount: Array.isArray(ownerProjects.json.projects)
      ? ownerProjects.json.projects.length
      : -1,
    hasScriptStage: ownerStages.some((s) => s.id === "script"),
    stageIds: ownerStages.map((s) => s.id),
    canMembers: (await req(ownerJar, `/api/projects/${assignedId}/members`))
      .status,
  });

  // CARD_ENGINEER
  const engJar = await login("smoke_engineer", PASSWORD);
  const engNav = await req(engJar, "/api/auth/navigation");
  const engWs = await req(engJar, "/api/workspace/projects");
  const engProjects = await req(engJar, "/api/projects");
  const engAssigned = await req(
    engJar,
    `/api/workspace/projects/${assignedId}`,
  );
  const engUnassigned = await req(
    engJar,
    `/api/workspace/projects/${other.projectId}`,
  );
  const engAssetsOk = await req(
    engJar,
    `/api/projects/${assignedId}/assets-draft`,
  );
  const engAssetsOther = await req(
    engJar,
    `/api/projects/${other.projectId}/assets-draft`,
  );
  const engVideo = await req(
    engJar,
    `/api/workspace/projects/${assignedId}/video-access`,
  );
  const engWorkflow = await req(
    engJar,
    `/api/workflow?projectId=${encodeURIComponent(assignedId)}`,
  );
  const engMgmtPage = await req(engJar, `/app/projects`);
  const engWorkflowPage = await req(
    engJar,
    `/workflow?projectId=${encodeURIComponent(assignedId)}`,
  );
  const engStages =
    (engAssigned.json.stages as Array<{ id: string }>) ?? [];

  results.push({
    role: "CARD_ENGINEER",
    navIds: ((engNav.json.navigation as Array<{ id: string }>) ?? []).map(
      (n) => n.id,
    ),
    workspaceIds: (
      (engWs.json.projects as Array<{ projectId: string }>) ?? []
    ).map((p) => p.projectId),
    managementStatus: engProjects.status,
    assignedStages: engStages.map((s) => s.id),
    unassignedStatus: engUnassigned.status,
    assetsAssigned: engAssetsOk.status,
    assetsOther: engAssetsOther.status,
    videoAccess: engVideo.status,
    workflowApi: engWorkflow.status,
    projectsPageStatus: engMgmtPage.status,
    workflowPageHasForbidden: engWorkflowPage.text.includes(
      "workflow-forbidden",
    ) || engWorkflowPage.text.includes("无权访问"),
    workflowPageHasEditor: engWorkflowPage.text.includes("WorkflowEditor") ||
      engWorkflowPage.text.includes("workflow-canvas-allowed"),
  });

  // Revoke and recheck
  await removeCardEngineer(assignedId, engineer.id);
  const afterWs = await req(engJar, "/api/workspace/projects");
  const afterAssets = await req(
    engJar,
    `/api/projects/${assignedId}/assets-draft`,
  );
  // restore membership for future smokes
  await addCardEngineer({
    projectId: assignedId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  results.push({
    role: "CARD_ENGINEER_REVOKED",
    workspaceCount: Array.isArray(afterWs.json.projects)
      ? afterWs.json.projects.length
      : -1,
    assetsStatus: afterAssets.status,
    restored: true,
  });

  return { ok: true as const, assignedId, results };
}

async function main() {
  const session = beginIsolatedSmokeAppDataSession({
    reuseExistingIfIsolated: true,
  });
  try {
    const result = await runCheck();
    console.log(
      JSON.stringify(
        {
          ...result,
          appDataDir: session.appDataDir,
          smokeRunId: session.smokeRunId,
        },
        null,
        2,
      ),
    );
  } finally {
    // Reused dirs are not deleted here (fixture may KEEP them).
    // Sessions created by this process are always removed.
    session.cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
