import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { chromium, type Page } from 'playwright';
import { assertSmokeDataDirectoryIsIsolated } from './lib/smoke-app-data-guard';

type Seed = {
  appDataDir: string;
  password: string;
  admin: string;
  owner: string;
  projectAId: string;
  episodeIds: { ep1: string; ep2: string; ep3: string };
};
type Step = { name: string; ok: boolean; detail?: unknown };

async function login(page: Page, base: string, username: string, password: string) {
  const response = await page.request.post(`${base}/api/auth/login`, { data: { username, password } });
  if (!response.ok()) throw new Error(`login ${username}: ${response.status()}`);
}

async function selectEpisode(page: Page, episodeId: string) {
  await page.getByTestId(`ead-episode-${episodeId}`).click();
  await page.waitForTimeout(500);
  await page.getByTestId('ead-extract').waitFor({ timeout: 15_000 });
}

async function waitForNote(page: Page, text: RegExp) {
  await page.locator('.amw-note').filter({ hasText: text }).waitFor({ timeout: 30_000 });
}

function draftPath(seed: Seed, fileName: string) {
  return path.join(seed.appDataDir, 'projects', seed.projectAId, 'drafts', fileName);
}

async function main() {
  const seedPath = process.argv[2];
  const port = process.argv[3] ?? '3044';
  if (!seedPath) throw new Error('Usage: smoke-batch-g1-browser.ts <seed.json> [port]');
  if (port === '3000') throw new Error('G1-R Smoke 禁止使用用户端口 3000');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as Seed;
  assertSmokeDataDirectoryIsIsolated(seed.appDataDir);
  const base = `http://localhost:${port}`;
  const steps: Step[] = [];
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  if (!existsSync(edgePath)) throw new Error('Microsoft Edge executable not found');
  const browser = await chromium.launch({ headless: true, executablePath: edgePath });
  const page = await browser.newPage();

  try {
    await login(page, base, seed.admin, seed.password);
    const binding = await page.request.put(`${base}/api/admin/api-configs`, {
      data: {
        action: 'update_binding',
        capabilityId: 'asset.episode-design.generate',
        profileSlotId: 'episode-asset-design-text',
        bindingEnabled: true,
      },
    });
    steps.push({ name: 'configure mock extraction', ok: binding.ok(), detail: binding.status() });
    await page.request.post(`${base}/api/auth/logout`);
    await login(page, base, seed.owner, seed.password);
    await page.goto(`${base}/app/projects/${seed.projectAId}/assets/design`, { waitUntil: 'networkidle' });
    await page.getByTestId('ead-extract').waitFor({ timeout: 30_000 });

    await selectEpisode(page, seed.episodeIds.ep1);
    await page.getByTestId('ead-extract').click();
    await waitForNote(page, /提取完成/);
    const note = page.locator('[data-testid^=ead-note-]').first();
    await note.waitFor({ timeout: 30_000 });
    steps.push({ name: 'extract', ok: (await page.locator('[data-testid^=ead-note-]').count()) > 0 });

    const editedNote = `G1-R 浏览器编辑 ${Date.now()}`;
    await note.fill(editedNote);
    await note.blur();
    await page.getByTestId('ead-save').click();
    await waitForNote(page, /已保存本集资产/);
    await page.reload({ waitUntil: 'networkidle' });
    await selectEpisode(page, seed.episodeIds.ep1);
    const persisted = await page.locator('[data-testid^=ead-note-]').first().inputValue();
    steps.push({ name: 'edit-save', ok: persisted === editedNote, detail: persisted });

    await page.getByTestId('ead-confirm').click();
    await page.getByTestId('ead-confirm-summary').waitFor({ timeout: 30_000 });
    steps.push({ name: 'confirm', ok: /已确认/.test(await page.getByTestId('ead-confirm-summary').innerText()) });

    const scriptPath = draftPath(seed, 'script.json');
    const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as { episodes: Array<{ id: string; content: string; updatedAt?: string }> };
    const ep1 = script.episodes.find((episode) => episode.id === seed.episodeIds.ep1);
    if (!ep1) throw new Error('fixture missing ep1');
    ep1.content += '\n\nG1-R stale mutation.';
    ep1.updatedAt = new Date().toISOString();
    writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf8');
    await page.reload({ waitUntil: 'networkidle' });
    await selectEpisode(page, seed.episodeIds.ep1);
    steps.push({ name: 'stale', ok: (await page.locator('body').innerText()).includes('本集剧本已发生变化') });

    await selectEpisode(page, seed.episodeIds.ep3);
    const detailResponse = await page.request.get(`${base}/api/projects/${seed.projectAId}/asset-designs/episodes/${seed.episodeIds.ep3}`);
    const detail = (await detailResponse.json()) as { record: { revision: number }; currentFingerprint: string };
    const emptyResponse = await page.request.put(`${base}/api/projects/${seed.projectAId}/asset-designs/episodes/${seed.episodeIds.ep3}`, {
      data: { expectedRevision: detail.record.revision, fingerprint: detail.currentFingerprint, items: [], status: 'review' },
    });
    await page.reload({ waitUntil: 'networkidle' });
    await selectEpisode(page, seed.episodeIds.ep3);
    steps.push({ name: 'empty', ok: emptyResponse.ok() && /手动添加/.test(await page.locator('body').innerText()) });

    await selectEpisode(page, seed.episodeIds.ep2);
    await page.route((url) => url.pathname.endsWith(`/api/projects/${seed.projectAId}/text-generations`), async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      await route.abort('aborted').catch(() => undefined);
    }, { times: 1 });
    await page.getByTestId('ead-extract').click();
    await page.getByTestId('ead-cancel-generate').waitFor({ timeout: 15_000 });
    await page.getByTestId('ead-cancel-generate').click();
    await waitForNote(page, /已取消生成/);
    steps.push({ name: 'cancel', ok: (await page.getByTestId('ead-cancel-generate').count()) === 0 });

    writeFileSync(draftPath(seed, 'episode-asset-designs.json'), '{ illegal json', 'utf8');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('ead-extract').waitFor({ timeout: 30_000 });
    const recoveryText = await page.locator('body').innerText();
    steps.push({ name: 'illegal-json-recovery', ok: await page.getByTestId('ead-extract').isEnabled() && !recoveryText.includes('无法加载剧集资产设计') });
  } finally {
    await browser.close();
  }

  const report = {
    kind: 'g1-r-browser',
    base,
    appDataDir: seed.appDataDir,
    touchedPort3000: false,
    steps,
    passed: steps.every((step) => step.ok),
    failed: steps.filter((step) => !step.ok).map((step) => step.name),
  };
  const reportPath = path.join(seed.appDataDir, 'g1-r-browser-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync('C:/Temp/g1-r-browser-report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!report.passed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
