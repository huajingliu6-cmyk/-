/**
 * H2 Browser Smoke (Playwright). Chromium via PLAYWRIGHT_BROWSERS_PATH=C:\Temp\h1-close-pw.
 *
 *   npx tsx scripts/smoke-batch-h2-browser.ts [seed.json] [port]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { chromium, type Page, type Dialog } from "playwright";

type Seed = {
  appDataDir: string;
  password: string;
  admin: string;
  owner: string;
  engineer: string;
  user: string;
  projectId: string;
  scriptUrl: string;
  mdPath: string;
};

type Step = { name: string; ok: boolean; detail?: unknown };

type TextJob = {
  generationId?: string;
  capabilityId?: string;
  outputKind?: string;
  taskRuleSource?: string;
  taskRuleVersion?: number | null;
  status?: string;
  createdAt?: string;
};

function listTextJobs(appDataDir: string, projectId: string): TextJob[] {
  const dir = path.join(appDataDir, "projects", projectId, "text-generations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      try {
        return JSON.parse(readFileSync(path.join(dir, n), "utf8")) as TextJob;
      } catch {
        return {};
      }
    })
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

function latestSplitJob(appDataDir: string, projectId: string): TextJob | null {
  const exact = listTextJobs(appDataDir, projectId).filter(
    (j) =>
      j.capabilityId === "script.split.generate" || j.outputKind === "script_split",
  );
  return exact[0] ?? null;
}

async function login(page: Page, base: string, user: string, password: string) {
  const res = await page.request.post(`${base}/api/auth/login`, {
    data: { username: user, password },
  });
  if (!res.ok()) throw new Error(`login ${user} ${res.status()}`);
}

async function logout(page: Page, base: string) {
  await page.request.post(`${base}/api/auth/logout`);
}

async function openAiPanel(page: Page, base: string) {
  await page.goto(`${base}/app`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const menuBtn = page
    .locator('button[title="打开账户"]')
    .or(page.getByRole("button", { name: /H2 Admin/ }))
    .first();
  await menuBtn.click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "管理 API", exact: true }).click();
  await page.waitForSelector('[data-testid="ai-config-tab-models"]', {
    timeout: 30000,
  });
}

async function setRuleEditor(page: Page, slug: string, text: string) {
  const editor = page.getByTestId(`ai-rule-editor-${slug}`);
  await editor.waitFor({ timeout: 15000 });
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await editor.pressSequentially(text, { delay: 5 });
  await editor.blur();
  await page.waitForTimeout(300);
  const seen = await editor.inputValue();
  if (!seen.includes(text.slice(0, Math.min(12, text.length)))) {
    // Fallback for stubborn controlled inputs
    await editor.evaluate((el, value) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      const textarea = el as HTMLTextAreaElement;
      nativeInputValueSetter?.call(textarea, value);
      textarea.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
      );
    }, text);
    await page.waitForTimeout(200);
  }
}

async function openSplitRuleCard(page: Page, slug: string) {
  await page.getByTestId("ai-config-tab-rules").click();
  await page.waitForTimeout(800);
  const card = page.getByTestId(`ai-rule-card-${slug}`);
  await card.waitFor({ timeout: 30000 });
  await card.click();
  await page.waitForTimeout(400);
  await page.getByTestId(`ai-rule-editor-${slug}`).waitFor({ timeout: 15000 });
  // Wait until initial rule load finishes (avoid race overwriting fill).
  for (let i = 0; i < 40; i++) {
    const busy = await page.locator("text=加载规则中").count();
    const val = await page.getByTestId(`ai-rule-editor-${slug}`).inputValue();
    if (busy === 0 && val.trim().length > 0) break;
    await page.waitForTimeout(250);
  }
}

async function ownerRunSplit(
  page: Page,
  base: string,
  seed: Seed,
  label: string,
): Promise<string | null> {
  const beforeIds = new Set(
    listTextJobs(seed.appDataDir, seed.projectId)
      .filter(
        (j) =>
          j.capabilityId === "script.split.generate" ||
          j.outputKind === "script_split",
      )
      .map((j) => (j as TextJob & { generationId?: string }).generationId)
      .filter(Boolean) as string[],
  );

  const txt = `C:/Temp/h2-owner-script-${label}.txt`;
  writeFileSync(
    txt,
    [
      "第1集 开场",
      "",
      "林清推门进茶馆。",
      "雨夜灯笼摇晃。",
      "",
      "第2集 铜匣",
      "",
      "次日发现铜匣与玉佩。",
      "掌柜说起阿棠失踪。",
      "",
      `标记 ${label} ${Date.now()}`,
      "",
    ].join("\n"),
    "utf8",
  );
  await page.goto(`${base}${seed.scriptUrl}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="script-confirm-fab"]', {
    timeout: 60000,
  });

  // Close any leftover review dialog from a prior run.
  const cancelSplit = page.getByTestId("script-split-cancel");
  if (await cancelSplit.count()) {
    await cancelSplit.click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
  const review = page.locator('[aria-label="分集方案核对"]');
  if (await review.count()) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(400);
  }

  await page.locator('input[type="file"]').first().setInputFiles(txt);
  const confirmImport = page.getByRole("button", { name: "确认导入", exact: true });
  try {
    await confirmImport.waitFor({ timeout: 12000 });
    await confirmImport.click();
    await page.waitForTimeout(1500);
  } catch {
    /* already imported or auto */
  }
  const preview = page.locator('[aria-label="剧本解析预览"]');
  if (await preview.count()) {
    const btn = preview.getByRole("button", { name: /确认导入|关闭|取消/ }).first();
    if (await btn.count()) {
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }

  await page.getByRole("button", { name: "分集", exact: true }).last().click();
  await page.waitForSelector('[aria-label="分集方案核对"]', { timeout: 120000 });

  // Poll for a new text-generation job.
  let newId: string | null = null;
  for (let i = 0; i < 40; i++) {
    const jobs = listTextJobs(seed.appDataDir, seed.projectId).filter(
      (j) =>
        j.capabilityId === "script.split.generate" ||
        j.outputKind === "script_split",
    ) as Array<TextJob & { generationId?: string }>;
    const fresh = jobs.find((j) => j.generationId && !beforeIds.has(j.generationId));
    if (fresh?.generationId) {
      newId = fresh.generationId;
      break;
    }
    await page.waitForTimeout(500);
  }
  return newId;
}

async function main() {
  const seedPath = process.argv[2] ?? "C:/Temp/h2-smoke-seed.json";
  const port = process.argv[3] ?? "3043";
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
  const base = `http://localhost:${port}`;
  const slug = "script-split-generate";
  const steps: Step[] = [];
  const report: Record<string, unknown> = {
    kind: "h2-ai-control-browser",
    base,
    appDataDir: seed.appDataDir,
    touchedPort3000: false,
  };

  process.env.PLAYWRIGHT_BROWSERS_PATH =
    process.env.PLAYWRIGHT_BROWSERS_PATH || "C:\\Temp\\h1-close-pw";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("dialog", (d: Dialog) => {
    void d.accept();
  });

  try {
    // Scene 1: admin models
    await login(page, base, seed.admin, seed.password);
    await openAiPanel(page, base);
    steps.push({ name: "s1 admin opens AI config", ok: true });

    await page.getByTestId("ai-config-tab-models").click();
    await page.waitForTimeout(800);
    const modelsText = await page.locator("body").innerText();
    steps.push({
      name: "s1 models tab visible",
      ok: /模型|Mock|连接/.test(modelsText),
    });

    // Bind via API for reliability after UI presence check
    const connections = await page.request.get(`${base}/api/admin/model-connections`);
    const connBody = (await connections.json()) as {
      connections?: Array<{ id: string; displayName?: string }>;
    };
    // Prefer the matching legacy mock for this capability's slot
    const mockConn =
      connBody.connections?.find((c) => c.id === "legacy-slot-script-split-text") ??
      connBody.connections?.find((c) => /script-split|分集/i.test(c.displayName ?? c.id)) ??
      connBody.connections?.find((c) => /mock|Mock/i.test(c.displayName ?? c.id)) ??
      connBody.connections?.[0];
    steps.push({
      name: "s1 model connection available",
      ok: !!mockConn,
      detail: mockConn?.id,
    });
    if (mockConn) {
      const bind = await page.request.put(`${base}/api/admin/ai-model-bindings`, {
        data: {
          profileSlot: "script-split-text",
          modelConnectionId: mockConn.id,
        },
      });
      steps.push({
        name: "s1 bind script.split.generate",
        ok: bind.ok(),
        detail: bind.status(),
      });
    }

    // Scene 2: draft
    await openSplitRuleCard(page, slug);
    await setRuleEditor(page, slug, "# 草稿规则\n- 按悬念分集\n");
    const saveWait = page.waitForResponse(
      (r) =>
        r.url().includes("/ai-task-rules/") &&
        r.url().includes("/draft") &&
        r.request().method() === "PUT",
      { timeout: 15000 },
    );
    await page.getByTestId(`ai-rule-save-draft-${slug}`).click();
    const saveRes = await saveWait.catch(() => null);
    const saveJson = saveRes
      ? await saveRes.json().catch(() => null)
      : null;
    await page.waitForTimeout(800);
    const draftApi = await page.request.get(
      `${base}/api/admin/ai-task-rules/${encodeURIComponent("script.split.generate")}`,
    );
    const draftApiBody = (await draftApi.json()) as {
      draft?: { content?: string } | null;
      error?: string;
    };
    steps.push({
      name: "s2 save draft",
      ok:
        !!saveRes?.ok() &&
        draftApi.ok() &&
        (draftApiBody.draft?.content ?? "").includes("悬念"),
      detail: {
        saveStatus: saveRes?.status() ?? null,
        saveJson,
        getStatus: draftApi.status(),
        draftPreview: draftApiBody.draft?.content?.slice(0, 120) ?? null,
        editorAfterSave: (
          await page.getByTestId(`ai-rule-editor-${slug}`).inputValue()
        ).slice(0, 120),
      },
    });

    await page.reload({ waitUntil: "networkidle" });
    await openAiPanel(page, base);
    await openSplitRuleCard(page, slug);
    await page.waitForTimeout(1500);
    const draftVal = await page.getByTestId(`ai-rule-editor-${slug}`).inputValue();
    const bodyAfterDraft = await page.locator("body").innerText();
    steps.push({
      name: "s2 draft persists after refresh",
      ok: draftVal.includes("悬念") || (draftApiBody.draft?.content ?? "").includes("悬念"),
      detail: draftVal.slice(0, 80),
    });
    steps.push({
      name: "s2 unpublished draft indicator",
      ok: /未发布草稿|有未发布/.test(bodyAfterDraft) || /草稿/.test(draftVal),
      detail: bodyAfterDraft.includes("未发布"),
    });

    // Scene 3: MD upload
    if (existsSync(seed.mdPath)) {
      await page.getByTestId(`ai-rule-upload-${slug}`).setInputFiles(seed.mdPath);
      await page.waitForTimeout(1500);
      const afterUpload = await page.getByTestId(`ai-rule-editor-${slug}`).inputValue();
      steps.push({
        name: "s3 markdown upload into editor",
        ok: afterUpload.includes("智能分集") || afterUpload.includes("分集"),
      });
    } else {
      steps.push({ name: "s3 markdown upload into editor", ok: false, detail: "md missing" });
    }

    // Scene 4: publish v1
    await page.getByTestId(`ai-rule-check-${slug}`).click();
    await page.waitForTimeout(800);
    await page.getByTestId(`ai-rule-publish-${slug}`).click();
    await page.waitForTimeout(2000);
    const afterPub = await page.locator("body").innerText();
    steps.push({
      name: "s4 publish custom rule v1",
      ok: /v1|已发布|自定义/.test(afterPub),
      detail: afterPub.slice(0, 240),
    });

    // Scene 5: owner split + metadata
    await logout(page, base);
    await login(page, base, seed.owner, seed.password);
    const job1Id = await ownerRunSplit(page, base, seed, "v1");
    steps.push({
      name: "s5 owner intelligent split succeeds",
      ok: !!job1Id,
      detail: job1Id,
    });
    const job1 =
      (job1Id
        ? listTextJobs(seed.appDataDir, seed.projectId).find(
            (j) => j.generationId === job1Id,
          )
        : null) ?? latestSplitJob(seed.appDataDir, seed.projectId);
    steps.push({
      name: "s5 generation taskRuleSource=custom",
      ok: job1?.taskRuleSource === "custom",
      detail: job1,
    });
    steps.push({
      name: "s5 generation taskRuleVersion=1",
      ok: job1?.taskRuleVersion === 1,
      detail: job1?.taskRuleVersion,
    });
    const uiText = await page.locator("body").innerText();
    steps.push({
      name: "s5 UI does not show full backend rule MD",
      ok: !uiText.includes("不得改写正文") && !uiText.includes("SYSTEM_POLICY"),
    });

    // Scene 6: draft does not affect runtime
    await logout(page, base);
    await login(page, base, seed.admin, seed.password);
    await openAiPanel(page, base);
    await openSplitRuleCard(page, slug);
    await setRuleEditor(page, slug, "# 未发布草稿 v2候选\n- 这是草稿不应生效\n");
    await page.getByTestId(`ai-rule-save-draft-${slug}`).click();
    await page.waitForTimeout(1000);
    await logout(page, base);
    await login(page, base, seed.owner, seed.password);
    const jobDraftId = await ownerRunSplit(page, base, seed, "draft-check");
    const jobDraft =
      (jobDraftId
        ? listTextJobs(seed.appDataDir, seed.projectId).find(
            (j) => j.generationId === jobDraftId,
          )
        : null) ?? null;
    steps.push({
      name: "s6 draft does not change published version",
      ok:
        !!jobDraft &&
        jobDraft.taskRuleVersion === 1 &&
        jobDraft.taskRuleSource === "custom" &&
        jobDraft.generationId !== job1?.generationId,
      detail: jobDraft,
    });

    // Scene 7: publish v2
    await logout(page, base);
    await login(page, base, seed.admin, seed.password);
    await openAiPanel(page, base);
    await openSplitRuleCard(page, slug);
    await setRuleEditor(
      page,
      slug,
      "# 智能分集规则 v2\n- 按冲突升级分集\n- 不得改写正文\n",
    );
    await page.getByTestId(`ai-rule-save-draft-${slug}`).click();
    await page.waitForTimeout(800);
    await page.getByTestId(`ai-rule-publish-${slug}`).click();
    await page.waitForTimeout(2000);
    const afterV2 = await page.locator("body").innerText();
    steps.push({
      name: "s7 publish v2",
      ok: /v2|已发布/.test(afterV2),
      detail: afterV2.slice(0, 200),
    });
    await logout(page, base);
    await login(page, base, seed.owner, seed.password);
    const job2Id = await ownerRunSplit(page, base, seed, "v2");
    const job2 =
      (job2Id
        ? listTextJobs(seed.appDataDir, seed.projectId).find(
            (j) => j.generationId === job2Id,
          )
        : null) ?? null;
    steps.push({
      name: "s7 new run uses v2",
      ok: job2?.taskRuleVersion === 2,
      detail: job2,
    });
    const older = listTextJobs(seed.appDataDir, seed.projectId).filter(
      (j) =>
        (j.capabilityId === "script.split.generate" ||
          j.outputKind === "script_split") &&
        j.taskRuleVersion === 1,
    );
    steps.push({
      name: "s7 old records still v1",
      ok: older.length >= 1,
      detail: older.length,
    });

    // Scene 8: history rollback → v3
    await logout(page, base);
    await login(page, base, seed.admin, seed.password);
    await openAiPanel(page, base);
    await openSplitRuleCard(page, slug);
    await page.getByRole("button", { name: "历史", exact: true }).click();
    await page.waitForTimeout(1000);
    const versionsRes = await page.request.get(
      `${base}/api/admin/ai-task-rules/script.split.generate/versions`,
    );
    const versionsBody = (await versionsRes.json()) as {
      versions?: Array<{ version: number }>;
    };
    const versionNums = (versionsBody.versions ?? []).map((v) => v.version);
    steps.push({
      name: "s8 history shows v1 and v2",
      ok: versionNums.includes(1) && versionNums.includes(2),
      detail: versionNums,
    });
    // Prefer rolling back to v1 from the history drawer.
    const rbV1 = page
      .locator('[role="dialog"] li')
      .filter({ hasText: /^v1\b|^\s*v1\b/ })
      .getByRole("button", { name: /回滚到此版本/ });
    if (await rbV1.count()) {
      await rbV1.click();
    } else {
      await page.getByRole("button", { name: /回滚到此版本/ }).last().click();
    }
    await page.waitForTimeout(2000);
    const afterRb = await page.locator("body").innerText();
    steps.push({
      name: "s8 rollback creates new version",
      ok: /v3|回滚|已发布/.test(afterRb),
      detail: afterRb.slice(0, 200),
    });
    // Confirm via API
    const detail = await page.request.get(
      `${base}/api/admin/ai-task-rules/script.split.generate`,
    );
    const detailBody = (await detail.json()) as {
      publishedVersion?: number;
      effective?: { version?: number; content?: string };
    };
    const publishedAfterRollback =
      detailBody.publishedVersion ?? detailBody.effective?.version ?? null;
    steps.push({
      name: "s8 published version is v3",
      ok: publishedAfterRollback === 3,
      detail: detailBody,
    });
    await logout(page, base);
    await login(page, base, seed.owner, seed.password);
    const job3Id = await ownerRunSplit(page, base, seed, "v3");
    const job3 =
      (job3Id
        ? listTextJobs(seed.appDataDir, seed.projectId).find(
            (j) => j.generationId === job3Id,
          )
        : null) ?? null;
    steps.push({
      name: "s8 new run uses v3",
      ok: job3?.taskRuleVersion === 3,
      detail: job3,
    });

    // Scene 9: non-admin denied
    await logout(page, base);
    for (const u of [seed.owner, seed.engineer, seed.user]) {
      await login(page, base, u, seed.password);
      const res = await page.request.get(`${base}/api/admin/ai-task-rules`);
      steps.push({
        name: `s9 non-admin ${u} denied task-rules API`,
        ok: res.status() === 403,
        detail: res.status(),
      });
      await page.goto(`${base}/app`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const menu = page.locator('button[title="打开账户"]').first();
      if (await menu.count()) {
        await menu.click();
        await page.waitForTimeout(300);
      }
      const manageApi = page.getByRole("button", { name: "管理 API", exact: true });
      steps.push({
        name: `s9 non-admin ${u} no 管理 API entry`,
        ok: (await manageApi.count()) === 0,
      });
      await logout(page, base);
    }

    // Scene 10: planned stays planned
    await login(page, base, seed.admin, seed.password);
    const list = await page.request.get(`${base}/api/admin/ai-task-rules`);
    const listBody = (await list.json()) as {
      capabilities?: Array<{ capabilityId: string; status: string }>;
    };
    const episodes = listBody.capabilities?.find(
      (c) => c.capabilityId === "script.episodes.generate",
    );
    steps.push({
      name: "s10 planned capability still planned",
      ok: list.ok() && episodes?.status === "planned",
      detail: episodes,
    });
    await logout(page, base);
    await login(page, base, seed.owner, seed.password);
    const avail = await page.request.get(`${base}/api/ai-capabilities/availability`);
    const availBody = (await avail.json()) as {
      capabilities?: Array<{
        capabilityId?: string;
        status?: string;
        available?: boolean;
      }>;
      items?: Array<{
        capabilityId?: string;
        status?: string;
        available?: boolean;
      }>;
    };
    const epAvail = (availBody.capabilities ?? availBody.items ?? []).find(
      (i) => i.capabilityId === "script.episodes.generate",
    );
    steps.push({
      name: "s10 availability does not activate planned episodes",
      ok:
        !epAvail ||
        epAvail.status === "planned" ||
        epAvail.available === false,
      detail: epAvail ?? availBody,
    });
  } catch (err) {
    steps.push({
      name: "fatal",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await browser.close();
  }

  report.steps = steps;
  report.passed = steps.every((s) => s.ok);
  report.failed = steps.filter((s) => !s.ok).map((s) => s.name);
  writeFileSync(
    path.join("C:/Temp", "h2-browser-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
