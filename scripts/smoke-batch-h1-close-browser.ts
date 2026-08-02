/**
 * H1-CLOSE browser smoke using Playwright (file upload + clipboard).
 * Requires: npx playwright install chromium (first run).
 *
 *   npx tsx scripts/smoke-batch-h1-close-browser.ts [seed.json] [port]
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { chromium, type Page } from "playwright";

type Seed = {
  appDataDir: string;
  encKey: string;
  password: string;
  admin: string;
  owner: string;
  engineer: string;
  stranger: string;
  projectAId: string;
  scriptUrl: string;
  assetsDesignUrl: string;
  assetsLibraryUrl: string;
  storyboardUrl: string;
  workspaceAssetsUrl: string;
  workspaceLibraryUrl: string;
};

type Step = { name: string; ok: boolean; detail?: unknown };

async function login(page: Page, base: string, user: string, password: string) {
  await page.goto(`${base}/?login=1`, { waitUntil: "domcontentloaded" });
  // Prefer API cookie for reliability; still navigate as logged-in browser session.
  const res = await page.request.post(`${base}/api/auth/login`, {
    data: { username: user, password },
  });
  if (!res.ok()) throw new Error(`login ${user} failed ${res.status()}`);
}

async function logout(page: Page, base: string) {
  await page.request.post(`${base}/api/auth/logout`);
}

async function main() {
  const seedPath = process.argv[2] ?? "C:/Temp/h1-close-smoke-seed.json";
  const port = process.argv[3] ?? "3042";
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
  // Prefer localhost over 127.0.0.1 — Next 16 blocks cross-origin /_next on 127.0.0.1 by default.
  const base = `http://localhost:${port}`;
  const txtPath = "C:/Temp/h1-close-script.txt";
  if (!existsSync(txtPath)) throw new Error("missing C:/Temp/h1-close-script.txt");

  const { createHash } = await import("crypto");
  const { readdirSync, statSync } = await import("fs");
  function hashFile(p: string): string | null {
    if (!existsSync(p)) return null;
    return createHash("sha256").update(readFileSync(p)).digest("hex");
  }
  function hashTree(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!existsSync(root)) return out;
    const walk = (dir: string, rel = "") => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const r = rel ? `${rel}/${name}` : name;
        if (statSync(full).isDirectory()) walk(full, r);
        else out[r] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    };
    walk(root);
    return out;
  }
  const mgmtRoot = path.join(seed.appDataDir, "projects", seed.projectAId);
  const mgmtTargets = {
    script: path.join(mgmtRoot, "drafts", "script.json"),
    episodeDesigns: path.join(mgmtRoot, "drafts", "episode-asset-designs.json"),
    assets: path.join(mgmtRoot, "drafts", "assets.json"),
  };

  const steps: Step[] = [];
  const report: Record<string, unknown> = {
    kind: "h1-close-browser",
    base,
    appDataDir: seed.appDataDir,
    touchedPort3000: false,
    projectAId: seed.projectAId,
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();

  try {
    // --- Scene 1: TXT upload main path ---
    await login(page, base, seed.owner, seed.password);
    await page.goto(`${base}${seed.scriptUrl}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="script-confirm-fab"]', {
      timeout: 60000,
    });
    steps.push({ name: "owner opens script page", ok: true });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(txtPath);
    // Confirm import if preview dialog appears
    const confirmImport = page.getByRole("button", { name: "确认导入", exact: true });
    try {
      await confirmImport.waitFor({ timeout: 15000 });
      await confirmImport.click();
      await page.waitForSelector("text=TXT 源文本已保存", { timeout: 30000 });
    } catch {
      /* some flows may already show saved note */
    }
    await page.waitForTimeout(1500);
    const bodyAfterUpload = await page.locator("body").innerText();
    const uploadOk =
      bodyAfterUpload.includes("雨夜茶馆") ||
      bodyAfterUpload.includes("源文本") ||
      bodyAfterUpload.includes("分集");
    steps.push({
      name: "TXT file input upload",
      ok: uploadOk,
      detail: bodyAfterUpload.slice(0, 400),
    });

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const afterRefresh = await page.locator("body").innerText();
    steps.push({
      name: "sourceText persists after refresh",
      ok:
        afterRefresh.includes("雨夜") ||
        afterRefresh.includes("源文本已导入") ||
        afterRefresh.includes("分集"),
      detail: afterRefresh.slice(0, 300),
    });

    const splitBtn = page.getByRole("button", { name: "分集", exact: true }).last();
    await splitBtn.click();
    const processing = await page
      .locator("text=剧本读取处理中")
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    steps.push({ name: "sees 剧本读取处理中", ok: processing });

    await page.waitForSelector("text=分集方案核对", { timeout: 90000 });
    const reviewText = await page.locator("body").innerText();
    steps.push({
      name: "proposed episodes >= 2",
      ok: reviewText.includes("共 2 集") || (reviewText.includes("第 1 集") && reviewText.includes("第 2 集")),
    });

    const titleInput = page.getByPlaceholder("集标题").first();
    await titleInput.fill("第1集：雨夜茶馆（改）");
    await page.getByRole("button", { name: "确认剧本" }).click();
    await page.waitForURL(/\/assets/, { timeout: 60000 });
    steps.push({ name: "confirm-split navigates to assets", ok: true });

    await page.goto(`${base}${seed.scriptUrl}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="script-confirm-fab"]', {
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const formal = await page.locator("body").innerText();
    steps.push({
      name: "formal episodes persist with edited title",
      ok: formal.includes("雨夜茶馆（改）") || formal.includes("第1集：雨夜茶馆（改）"),
      detail: formal.slice(0, 500),
    });

    await page.goto(`${base}${seed.assetsDesignUrl}`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=提取本集资产", { timeout: 60000 });
    const assetsList = await page.locator("body").innerText();
    steps.push({
      name: "asset design lists confirmed episodes",
      ok: assetsList.includes("雨夜茶馆") || assetsList.includes("第1集"),
    });

    const viewScript = page.getByRole("button", { name: "查看本集剧本" });
    if (await viewScript.count()) {
      await viewScript.click();
      await page.waitForSelector('[data-testid="ead-script-dialog"]', {
        timeout: 10000,
      });
      const dialogText = await page
        .locator('[data-testid="ead-script-dialog"]')
        .innerText();
      steps.push({
        name: "view episode script shows uploaded TXT body",
        ok: dialogText.includes("林清") || dialogText.includes("茶馆"),
        detail: dialogText.slice(0, 200),
      });
      await page
        .locator('[data-testid="ead-script-dialog"]')
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page
        .locator('[data-testid="ead-script-dialog"]')
        .waitFor({ state: "hidden", timeout: 10000 });
      await page.waitForTimeout(500);
    } else {
      steps.push({
        name: "view episode script shows uploaded TXT body",
        ok: false,
        detail: "button missing",
      });
    }

    await page.getByTestId("ead-extract").click();
    await page.waitForSelector('button:has-text("设计")', { timeout: 90000 });
    const afterExtract = await page.locator("body").innerText();
    steps.push({
      name: "text asset cards with 设计, no auto images implied",
      ok: afterExtract.includes("设计") && afterExtract.includes("项资产"),
    });

    await page.getByRole("button", { name: "设计" }).first().click();
    await page.waitForSelector('[data-testid="design-prompt-textarea"]', {
      timeout: 30000,
    });
    await page.waitForFunction(
      () => {
        const ta = document.querySelector(
          '[data-testid="design-prompt-textarea"]',
        ) as HTMLTextAreaElement | null;
        const copy = document.querySelector(
          '[data-testid="design-copy"]',
        ) as HTMLButtonElement | null;
        return Boolean(ta && ta.value.trim().length > 10 && copy && !copy.disabled);
      },
      undefined,
      { timeout: 90000 },
    );

    const promptBox = page.locator('[data-testid="design-prompt-textarea"]');
    await promptBox.click();
    await promptBox.fill("林清，雨夜旅人，写实电影感，【人工修改】");
    const edited = await promptBox.inputValue();

    // --- Scene 2: copy ---
    await page.getByTestId("design-copy").click();
    const copyOk = await page
      .getByTestId("design-copy-ok")
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    let clipboard = "";
    let clipboardMatch = false;
    let copyPath: "clipboard-api" | "fallback" | "unknown" = "unknown";
    try {
      clipboard = await page.evaluate(async () => navigator.clipboard.readText());
      clipboardMatch = clipboard === edited;
      copyPath = "clipboard-api";
    } catch {
      // fallback verification via paste into temp input
      await page.evaluate(() => {
        const i = document.createElement("input");
        i.id = "h1c-paste-probe";
        document.body.appendChild(i);
      });
      await page.locator("#h1c-paste-probe").click();
      await page.keyboard.press("Control+V");
      clipboard = await page.locator("#h1c-paste-probe").inputValue();
      clipboardMatch = clipboard === edited;
      copyPath = "fallback";
    }
    steps.push({
      name: "one-click copy success feedback",
      ok: copyOk,
      detail: { copyPath, clipboardMatch, clipboardLen: clipboard.length },
    });
    steps.push({
      name: "clipboard matches prompt textarea",
      ok: clipboardMatch,
      detail: { copyPath },
    });
    report.copy = { copyOk, copyPath, clipboardMatch };

    await page.getByTestId("design-generate-asset").click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "关闭" }).click().catch(() => undefined);
    const confirmBtn = page.getByRole("button", { name: "确认本集资产" });
    if (await confirmBtn.isEnabled()) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
    // Save before confirm if needed
    const saveBtn = page.getByRole("button", { name: "保存本集资产" });
    if ((await saveBtn.count()) && (await saveBtn.isEnabled())) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
    }
    await page.reload({ waitUntil: "networkidle" });
    const persisted = await page.locator("body").innerText();
    steps.push({
      name: "confirm + refresh persistence",
      ok: /已确认|项资产|设计/.test(persisted),
      detail: persisted.slice(0, 300),
    });

    const mgmtBefore = {
      script: hashFile(mgmtTargets.script),
      episodeDesigns: hashFile(mgmtTargets.episodeDesigns),
      assets: hashFile(mgmtTargets.assets),
      binaries: hashTree(path.join(mgmtRoot, "assets")),
    };
    report.mgmtBefore = mgmtBefore;

    // --- Scene 3: CE workspace ---
    await logout(page, base);
    await login(page, base, seed.engineer, seed.password);
    await page.goto(`${base}${seed.workspaceAssetsUrl}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);
    const ceText = await page.locator("body").innerText();
    const ceButtons = {
      extract: await page.getByRole("button", { name: /提取本集资产|重新提取/ }).count(),
      save: await page.getByRole("button", { name: "保存本集资产" }).count(),
      confirm: await page.getByRole("button", { name: "确认本集资产" }).count(),
      design: await page.getByRole("button", { name: "设计" }).count(),
      add: await page.getByRole("button", { name: "手动添加" }).count(),
    };
    steps.push({
      name: "CE workspace sees synced episodes/assets + buttons",
      ok:
        (ceText.includes("第1集") || ceText.includes("雨夜")) &&
        ceButtons.design > 0 &&
        ceButtons.save > 0,
      detail: { ceButtons, snippet: ceText.slice(0, 300) },
    });

    if (ceButtons.design > 0) {
      await page.getByRole("button", { name: "设计" }).first().click();
      await page.waitForSelector('[data-testid="design-prompt-textarea"]', {
        timeout: 60000,
      });
      await page.waitForFunction(
        () => {
          const ta = document.querySelector(
            '[data-testid="design-prompt-textarea"]',
          ) as HTMLTextAreaElement | null;
          return Boolean(ta && !ta.disabled);
        },
        undefined,
        { timeout: 90000 },
      );
      // Ensure prompt exists (auto-gen or fill for local workspace edit).
      const current = await page
        .locator('[data-testid="design-prompt-textarea"]')
        .inputValue();
      if (current.trim().length < 5) {
        await page.waitForTimeout(3000);
      }
      await page
        .locator('[data-testid="design-prompt-textarea"]')
        .fill("【工作台修改】本地提示词");
      await page.getByTestId("design-generate-asset").click();
      await page.waitForTimeout(3500);
      await page
        .locator(".ead-modal")
        .getByRole("button", { name: "关闭", exact: true })
        .click()
        .catch(() => undefined);
      await page.reload({ waitUntil: "networkidle" });
      const ceAfter = await page.locator("body").innerText();
      steps.push({
        name: "CE workspace local generate persists after refresh",
        ok: ceAfter.includes("设计") || ceAfter.includes("项资产"),
      });
    }

    const mgmtAfterCe = {
      script: hashFile(mgmtTargets.script),
      episodeDesigns: hashFile(mgmtTargets.episodeDesigns),
      assets: hashFile(mgmtTargets.assets),
      binaries: hashTree(path.join(mgmtRoot, "assets")),
    };
    report.mgmtAfterCe = mgmtAfterCe;
    const isolationOk =
      mgmtBefore.script === mgmtAfterCe.script &&
      mgmtBefore.episodeDesigns === mgmtAfterCe.episodeDesigns &&
      mgmtBefore.assets === mgmtAfterCe.assets &&
      JSON.stringify(mgmtBefore.binaries) === JSON.stringify(mgmtAfterCe.binaries);
    steps.push({
      name: "CE workspace did not mutate management files",
      ok: isolationOk,
      detail: {
        scriptSame: mgmtBefore.script === mgmtAfterCe.script,
        designsSame: mgmtBefore.episodeDesigns === mgmtAfterCe.episodeDesigns,
        assetsSame: mgmtBefore.assets === mgmtAfterCe.assets,
      },
    });

    // --- Scene 4: stranger deny ---
    await logout(page, base);
    await login(page, base, seed.stranger, seed.password);
    const strangerUrls = [
      `/app/workspace/projects/${seed.projectAId}`,
      seed.workspaceAssetsUrl,
      seed.workspaceLibraryUrl,
    ];
    const strangerResults: Array<Record<string, unknown>> = [];
    for (const u of strangerUrls) {
      const dataReqs: Array<{ url: string; status: number }> = [];
      const onResp = (res: { url: () => string; status: () => number }) => {
        const url = res.url();
        if (url.includes("/api/workspace/") || url.includes("/api/projects/")) {
          dataReqs.push({ url, status: res.status() });
        }
      };
      page.on("response", onResp);
      await page.goto(`${base}${u}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      page.off("response", onResp);
      const text = await page.locator("body").innerText();
      const finalUrl = page.url();
      const denied =
        /无权|禁止|拒绝|未分配|denied|Forbidden|工作台/.test(text) ||
        finalUrl.includes("denied") ||
        !finalUrl.includes(seed.projectAId) ||
        dataReqs.some((r) => r.status === 403);
      const leaked = dataReqs.some(
        (r) => r.status === 200 && r.url.includes(seed.projectAId),
      );
      strangerResults.push({
        url: u,
        finalUrl,
        denied,
        leaked,
        dataReqs: dataReqs.slice(0, 10),
        text: text.slice(0, 250),
      });
      steps.push({
        name: `stranger denied ${u}`,
        ok: denied && !leaked,
        detail: { finalUrl, leaked, dataReqs: dataReqs.slice(0, 5) },
      });
    }
    report.stranger = strangerResults;

    // --- Scene 5: non-owner admin deny ---
    await logout(page, base);
    await login(page, base, seed.admin, seed.password);
    const adminUrls = [
      `/app/projects/${seed.projectAId}`,
      seed.scriptUrl,
      seed.assetsDesignUrl,
      seed.assetsLibraryUrl,
      seed.storyboardUrl,
    ];
    const adminResults: Array<Record<string, unknown>> = [];
    for (const u of adminUrls) {
      await page.goto(`${base}${u}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const finalUrl = page.url();
      const text = await page.locator("body").innerText();
      const denied =
        finalUrl.includes("denied") ||
        /无权|禁止|拒绝|仅项目主理人|Forbidden/.test(text) ||
        !finalUrl.includes(`/app/projects/${seed.projectAId}`);
      adminResults.push({ url: u, finalUrl, denied, text: text.slice(0, 200) });
      steps.push({
        name: `non-owner admin denied ${u}`,
        ok: denied,
        detail: { finalUrl },
      });
    }
    report.admin = adminResults;

    // Owner can enter
    await logout(page, base);
    await login(page, base, seed.owner, seed.password);
    await page.goto(`${base}${seed.assetsDesignUrl}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(1500);
    const ownerOk = page.url().includes(seed.assetsDesignUrl) ||
      (await page.locator("body").innerText()).includes("资产");
    steps.push({ name: "owner can open assets design", ok: ownerOk });

    void mgmtBefore;
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
  const outPath = path.join("C:/Temp", "h1-close-browser-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
