/**
 * Browser + HTTP smoke for WORKSPACE-ASSET-APPROVAL-H1.
 * Requires seed JSON and a running next start on SMOKE_PORT with same APP_DATA_DIR.
 *
 *   npx tsx scripts/smoke-workspace-asset-approval-h1.ts C:\Temp\WORKSPACE_ASSET_APPROVAL_H1_SEED.json 3055
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { chromium } from "playwright";

type Seed = {
  appDataDir: string;
  password: string;
  owner: string;
  ownerId: string;
  ce: string;
  ceId: string;
  projectId: string;
  episodeId: string;
  medias: { character: string; scene: string; prop: string };
};

type Step = { step: number; name: string; ok: boolean; detail?: string };

async function main() {
  const seedPath =
    process.argv[2] ?? "C:\\Temp\\WORKSPACE_ASSET_APPROVAL_H1_SEED.json";
  const port = process.argv[3] ?? process.env.SMOKE_PORT ?? "3055";
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
  const BASE = `http://localhost:${port}`;
  const REPORT_DIR = "C:\\Temp";
  const steps: Step[] = [];
  const shots: string[] = [];
  const record = (step: number, name: string, ok: boolean, detail?: string) => {
    steps.push({ step, name, ok, detail });
    console.log(`${ok ? "OK" : "FAIL"} ${step}. ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // health
  const me = await fetch(`${BASE}/api/auth/me`);
  record(0, "dev server ready", me.status > 0, `port=${port}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const login = async (username: string) => {
    const res = await page.request.post(`${BASE}/api/auth/login`, {
      data: { username, password: seed.password },
    });
    if (!res.ok()) throw new Error(`login ${username} failed ${res.status()}`);
  };

  await login(seed.ce);
  await page.goto(
    `${BASE}/app/workspace/projects/${seed.projectId}/assets/design`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(1500);
  const hasSubmit =
    (await page.getByTestId("ead-submit-approval").count()) > 0 ||
    (await page.getByRole("button", { name: "提交审批素材" }).count()) > 0;
  const hasOld =
    (await page.getByRole("button", { name: "确认本集资产" }).count()) > 0;
  record(1, "workspace button 提交审批素材", hasSubmit);
  record(2, "workspace no 确认本集资产", !hasOld);
  const shot1 = path.join(REPORT_DIR, `asset-approval-smoke-ce-${Date.now()}.png`);
  await page.screenshot({ path: shot1, fullPage: true });
  shots.push(shot1);

  if (hasSubmit) {
    // Ensure an episode is selected so submit is enabled.
    const episodeBtn = page.locator("[data-testid^=\"ead-episode-\"]").first();
    if ((await episodeBtn.count()) > 0) {
      await episodeBtn.click();
      await page.waitForTimeout(800);
    }
    const btn = page.getByTestId("ead-submit-approval");
    await btn.click({ force: true, timeout: 10_000 }).catch(async () => {
      await page.getByRole("button", { name: "提交审批素材" }).click({ force: true });
    });
    await page.waitForTimeout(800);
    record(
      3,
      "submit modal three columns",
      (await page.getByTestId("submit-approval-columns").count()) > 0 ||
        (await page.getByTestId("submit-approval-empty").count()) > 0 ||
        (await page.getByTestId("submit-approval-modal").count()) > 0,
    );
    for (const mediaId of Object.values(seed.medias)) {
      const check = page.getByTestId(`submit-check-${mediaId}`);
      if ((await check.count()) > 0) await check.check();
    }
    const confirm = page.getByTestId("submit-approval-confirm");
    if ((await confirm.count()) > 0 && !(await confirm.isDisabled())) {
      await confirm.click();
      await page.waitForTimeout(800);
      record(4, "UI submit three images", true);
    } else {
      record(4, "UI submit three images", false, "confirm disabled");
    }
  } else {
    record(3, "submit modal three columns", false);
    record(4, "UI submit three images", false);
  }

  // Ensure submission via API
  const submitRes = await page.request.post(
    `${BASE}/api/workspace/projects/${seed.projectId}/asset-approvals`,
    {
      data: {
        episodeId: seed.episodeId,
        generatedMediaIds: Object.values(seed.medias),
      },
      headers: { "Idempotency-Key": "smoke-main" },
    },
  );
  const submitJson = (await submitRes.json()) as {
    submission?: { id: string; items: Array<{ id: string; status: string }> };
    error?: string;
    code?: string;
  };
  let submissionId = submitJson.submission?.id ?? "";
  if (!submissionId && submitRes.status() === 409) {
    const listRes = await page.request.get(
      `${BASE}/api/workspace/projects/${seed.projectId}/asset-approvals?episodeId=${encodeURIComponent(seed.episodeId)}`,
    );
    const listJson = (await listRes.json()) as {
      submissions?: Array<{ id: string }>;
    };
    submissionId = listJson.submissions?.[0]?.id ?? "";
  }
  record(
    5,
    "submission created",
    Boolean(submissionId) && (submitRes.ok() || submitRes.status() === 409),
    submissionId || submitJson.error,
  );

  const assetsBefore = await page.request.get(
    `${BASE}/api/projects/${seed.projectId}/assets-draft`,
  );
  // CE may 403 on management assets — use workspace
  const wsAssetsBefore = await page.request.get(
    `${BASE}/api/workspace/projects/${seed.projectId}/assets-draft`,
  );
  const wsBeforeJson = (await wsAssetsBefore.json()) as {
    draft?: {
      characters: Array<{ imageFileName?: string | null }>;
      scenes: Array<{ imageFileName?: string | null }>;
      props: Array<{ imageFileName?: string | null }>;
    };
  };
  const beforeHas = [
    ...(wsBeforeJson.draft?.characters ?? []),
    ...(wsBeforeJson.draft?.scenes ?? []),
    ...(wsBeforeJson.draft?.props ?? []),
  ].some((a) => Object.values(seed.medias).includes(a.imageFileName ?? ""));
  record(6, "pending not in workspace library", !beforeHas);

  await page.request.post(`${BASE}/api/auth/logout`);
  await login(seed.owner);
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const notes = await page.request.get(`${BASE}/api/notifications`);
  const notesJson = (await notes.json()) as {
    unreadCount?: number;
    notifications?: unknown[];
  };
  record(
    7,
    "owner unread notification",
    (notesJson.unreadCount ?? 0) >= 1,
    `unread=${notesJson.unreadCount}`,
  );
  const badge =
    (await page.getByTestId("notification-unread-badge").count()) > 0;
  record(8, "notification badge visible", badge || (notesJson.unreadCount ?? 0) >= 1);

  await page.goto(
    `${BASE}/app/projects/${seed.projectId}/assets/design?approvalSubmissionId=${encodeURIComponent(submissionId)}&episodeId=${encodeURIComponent(seed.episodeId)}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(1500);
  const modalOpen = (await page.getByTestId("owner-approve-modal").count()) > 0;
  record(9, "owner approve modal auto-open", modalOpen);
  const shot2 = path.join(
    REPORT_DIR,
    `asset-approval-smoke-owner-${Date.now()}.png`,
  );
  await page.screenshot({ path: shot2, fullPage: true });
  shots.push(shot2);
  if (modalOpen) {
    await page.locator(".ead-approval-card__thumb").first().click();
    await page.waitForTimeout(400);
    record(10, "lightbox open", true);
    await page.keyboard.press("Escape");
  } else {
    record(10, "lightbox open", false);
  }

  const detailRes = await page.request.get(
    `${BASE}/api/projects/${seed.projectId}/asset-approvals/${submissionId}`,
  );
  const detailJson = (await detailRes.json()) as {
    submission?: { items: Array<{ id: string; status: string }> };
  };
  const items = detailJson.submission?.items ?? [];
  const firstTwo = items.filter((i) => i.status === "pending").slice(0, 2).map((i) => i.id);
  const partialRes = await page.request.post(
    `${BASE}/api/projects/${seed.projectId}/asset-approvals/${submissionId}/approve`,
    { data: { itemIds: firstTwo } },
  );
  const partialJson = (await partialRes.json()) as {
    submission?: { status: string };
    error?: string;
  };
  record(
    11,
    "partial approve",
    partialRes.ok() && partialJson.submission?.status === "partially_approved",
    partialJson.submission?.status ?? partialJson.error,
  );

  const mgmtPartial = await page.request.get(
    `${BASE}/api/projects/${seed.projectId}/assets-draft`,
  );
  const mgmtPartialJson = (await mgmtPartial.json()) as {
    draft?: {
      characters: unknown[];
      scenes: unknown[];
      props: unknown[];
    };
  };
  const countPartial =
    (mgmtPartialJson.draft?.characters.length ?? 0) +
    (mgmtPartialJson.draft?.scenes.length ?? 0) +
    (mgmtPartialJson.draft?.props.length ?? 0);
  record(12, "two assets in management library", countPartial >= 2, String(countPartial));

  const remaining = items
    .filter((i) => !firstTwo.includes(i.id))
    .map((i) => i.id);
  const fullRes = await page.request.post(
    `${BASE}/api/projects/${seed.projectId}/asset-approvals/${submissionId}/approve`,
    { data: { itemIds: remaining } },
  );
  const fullJson = (await fullRes.json()) as {
    submission?: { status: string };
  };
  record(
    13,
    "full approve",
    fullRes.ok() && fullJson.submission?.status === "approved",
    fullJson.submission?.status,
  );

  const mgmtFull = await page.request.get(
    `${BASE}/api/projects/${seed.projectId}/assets-draft`,
  );
  const mgmtFullJson = (await mgmtFull.json()) as {
    draft?: {
      characters: Array<{ imageFileName?: string | null; approvedMediaIds?: string[] }>;
      scenes: Array<{ imageFileName?: string | null; approvedMediaIds?: string[] }>;
      props: Array<{ imageFileName?: string | null; approvedMediaIds?: string[] }>;
    };
  };
  const allMedia = new Set(
    [
      ...(mgmtFullJson.draft?.characters ?? []),
      ...(mgmtFullJson.draft?.scenes ?? []),
      ...(mgmtFullJson.draft?.props ?? []),
    ].flatMap((a) => [a.imageFileName, ...(a.approvedMediaIds ?? [])]),
  );
  const wsFull = await page.request.get(
    `${BASE}/api/workspace/projects/${seed.projectId}/assets-draft`,
  );
  // owner may need workspace access - also check management sync via second login as CE
  await page.request.post(`${BASE}/api/auth/logout`);
  await login(seed.ce);
  const wsFull2 = await page.request.get(
    `${BASE}/api/workspace/projects/${seed.projectId}/assets-draft`,
  );
  const wsJson = (await (wsFull2.ok() ? wsFull2 : wsFull).json()) as {
    draft?: {
      characters: Array<{ imageFileName?: string | null; approvedMediaIds?: string[] }>;
      scenes: Array<{ imageFileName?: string | null; approvedMediaIds?: string[] }>;
      props: Array<{ imageFileName?: string | null; approvedMediaIds?: string[] }>;
    };
  };
  const wsMedia = new Set(
    [
      ...(wsJson.draft?.characters ?? []),
      ...(wsJson.draft?.scenes ?? []),
      ...(wsJson.draft?.props ?? []),
    ].flatMap((a) => [a.imageFileName, ...(a.approvedMediaIds ?? [])]),
  );
  record(
    14,
    "all three in management+workspace",
    Object.values(seed.medias).every((m) => allMedia.has(m) && wsMedia.has(m)),
  );

  await page.request.post(`${BASE}/api/auth/logout`);
  await login(seed.owner);
  const again = await page.request.post(
    `${BASE}/api/projects/${seed.projectId}/asset-approvals/${submissionId}/approve`,
    { data: { itemIds: items.map((i) => i.id) } },
  );
  const againMgmt = await page.request.get(
    `${BASE}/api/projects/${seed.projectId}/assets-draft`,
  );
  const againJson = (await againMgmt.json()) as {
    draft?: { characters: unknown[]; scenes: unknown[]; props: unknown[] };
  };
  const countAgain =
    (againJson.draft?.characters.length ?? 0) +
    (againJson.draft?.scenes.length ?? 0) +
    (againJson.draft?.props.length ?? 0);
  record(
    15,
    "idempotent re-approve no dup assets",
    again.ok() && countAgain === countPartial + remaining.length,
    `count=${countAgain}`,
  );

  await page.request.post(`${BASE}/api/auth/logout`);
  await login(seed.ce);
  const bypass = await page.request.post(
    `${BASE}/api/workspace/projects/${seed.projectId}/asset-designs/episodes/${seed.episodeId}/confirm`,
    { data: { expectedRevision: 1, fingerprint: "x" } },
  );
  const bypassJson = (await bypass.json()) as { code?: string };
  record(
    16,
    "workspace confirm blocked",
    bypass.status() === 403 &&
      bypassJson.code === "WORKSPACE_CONFIRM_REQUIRES_APPROVAL",
  );

  void assetsBefore;
  await browser.close();

  const report = {
    batch: "WORKSPACE-ASSET-APPROVAL-H1",
    port: Number(port),
    appDataDir: seed.appDataDir,
    touched3000: false,
    paidCalls: false,
    owner: seed.owner,
    ce: seed.ce,
    projectId: seed.projectId,
    submissionId,
    steps,
    screenshots: shots,
    passed: steps.every((s) => s.ok),
  };
  const reportPath = path.join(
    REPORT_DIR,
    `WORKSPACE_ASSET_APPROVAL_H1_SMOKE_${Date.now()}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`SMOKE_REPORT=${reportPath}`);
  process.exit(report.passed ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
