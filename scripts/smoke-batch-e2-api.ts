/**
 * Batch E2 API smoke runner (isolated APP_DATA_DIR).
 * Seeds data, optionally binds capability, exercises generate/apply/conflict/permissions.
 *
 * Usage (after seed sets APP_DATA_DIR via env from seed JSON):
 *   npx tsx scripts/smoke-batch-e2-api.ts <seed.json> [port]
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { loadScriptDraft } from "../src/projects/script/script-draft-store";
import { loadWorkspace } from "../src/projects/storyboard/production-store";
import { outlineContentFingerprint } from "../src/projects/script/script-episodes-generation-schema";
import { listGenerationRecords } from "../src/video-generation/generation-store";
import { getCreditBalance } from "../src/text-generation/credits";

type Seed = {
  appDataDir: string;
  encKey: string;
  password: string;
  admin: string;
  owner: string;
  engineer: string;
  stranger: string;
  projectAId: string;
  projectBId: string;
};

type CookieJar = Map<string, string>;

function storeCookies(jar: CookieJar, res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) {
      const part = single.split(";")[0]!;
      const eq = part.indexOf("=");
      if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
    return;
  }
  for (const c of raw) {
    const part = c.split(";")[0]!;
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(
  base: string,
  username: string,
  password: string,
): Promise<CookieJar> {
  const jar: CookieJar = new Map();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  storeCookies(jar, res);
  if (!res.ok) throw new Error(`login failed ${username}: ${res.status}`);
  return jar;
}

async function readSse(res: Response): Promise<{
  text: string;
  events: string[];
  errorCode?: string;
}> {
  const raw = await res.text();
  let text = "";
  const events: string[] = [];
  let errorCode: string | undefined;
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    events.push(event);
    if (event === "delta") {
      try {
        const data = JSON.parse(dataLines.join("\n")) as { text?: string };
        if (data.text) text += data.text;
      } catch {
        /* ignore */
      }
    }
    if (event === "error") {
      try {
        const data = JSON.parse(dataLines.join("\n")) as { code?: string };
        errorCode = data.code;
      } catch {
        /* ignore */
      }
    }
  }
  return { text, events, errorCode };
}

async function main() {
  const seedPath = process.argv[2];
  const port = process.argv[3] ?? "3020";
  if (!seedPath) {
    console.error("Usage: npx tsx scripts/smoke-batch-e2-api.ts <seed.json> [port]");
    process.exit(1);
  }
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
  process.env.APP_DATA_DIR = seed.appDataDir;
  process.env.AI_CONFIG_ENCRYPTION_KEY = seed.encKey;
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.TEXT_LLM_PROVIDER = "mock";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";

  const base = `http://127.0.0.1:${port}`;
  const report: Record<string, unknown> = { base, appDataDir: seed.appDataDir };

  // Ensure unbound before the availability check
  await updateCapabilityBinding(
    "script.episodes.generate",
    { profileSlotId: null, enabled: true },
    "smoke-reset",
  );

  const ownerJar = await login(base, seed.owner, seed.password);
  const meRes = await fetch(`${base}/api/auth/me`, {
    headers: { Cookie: cookieHeader(ownerJar) },
  });
  const me = (await meRes.json()) as { user?: { id: string } };
  const beforeCredits =
    typeof me.user?.id === "string" ? await getCreditBalance(me.user.id) : -1;

  // 1) Unbound: generate must fail without reserve success path
  const unbound = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/text-generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        outputKind: "script_episodes",
        brief: "",
        outlineText:
          "【故事核心】E2 烟雾测试大纲\n【主线冲突】旧秩序与新线索\n【阶段推进】开端→升级→收束",
        episodeNumber: 2,
        modelKey: "balanced-default",
        targetChars: 400,
        idempotencyKey: `e2_unbound_${Date.now()}`,
      }),
    },
  );
  const unboundSse = await readSse(unbound);
  report.unboundError = unboundSse.errorCode;
  const draftUnbound = await loadScriptDraft(seed.projectAId);
  report.unboundDraftUnchanged =
    draftUnbound?.episodes.find((e) => e.episodeNumber === 2)?.content ===
    "旧正文二";

  // 2) Bind mock episodes profile
  await updateGenerationApiConfig("script-episodes-text", {
    provider: "mock",
    enabled: true,
  });
  await updateCapabilityBinding(
    "script.episodes.generate",
    { profileSlotId: "script-episodes-text", enabled: true },
    "smoke",
  );

  // 3) Generate
  const gen = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/text-generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        outputKind: "script_episodes",
        brief: "补充",
        outlineText: draftUnbound?.outlineText,
        episodeNumber: 2,
        modelKey: "balanced-default",
        targetChars: 400,
        idempotencyKey: `e2_gen_${Date.now()}`,
      }),
    },
  );
  const genSse = await readSse(gen);
  report.genStatus = gen.status;
  report.genEvents = genSse.events;
  report.genError = genSse.errorCode ?? null;
  report.genTextPreview = genSse.text.slice(0, 120);
  if (!genSse.text.trim().startsWith("{")) {
    report.ok = false;
    throw new Error(
      `generation did not return JSON: status=${gen.status} err=${genSse.errorCode} text=${genSse.text.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(genSse.text) as {
    version: number;
    episodes: Array<{ number: number; title: string; content: string }>;
  };
  report.genParsedOk =
    parsed.version === 1 &&
    parsed.episodes.length === 1 &&
    parsed.episodes[0]!.number === 2;
  const mid = await loadScriptDraft(seed.projectAId);
  report.previewDidNotMutate =
    mid?.episodes.find((e) => e.episodeNumber === 2)?.content === "旧正文二";

  // 4) Apply
  const apply = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/script-draft`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        applyGeneratedEpisodes: parsed,
        expectedUpdatedAt: mid?.updatedAt,
        expectedOutlineFingerprint: outlineContentFingerprint(
          mid?.outlineText ?? "",
        ),
      }),
    },
  );
  const applyBody = (await apply.json()) as {
    invalidated?: boolean;
    draft?: { episodes?: unknown[]; sourceImport?: unknown };
  };
  report.applyStatus = apply.status;
  report.applyInvalidated = applyBody.invalidated === true;
  const after = await loadScriptDraft(seed.projectAId);
  report.afterOutlineKept =
    after?.outlineText === mid?.outlineText && Boolean(after?.outlineText);
  report.afterSourceImportCleared = after?.sourceImport === null;
  report.afterEpisode2Changed =
    after?.episodes.find((e) => e.episodeNumber === 2)?.content !== "旧正文二";
  report.afterEp1IdKept =
    after?.episodes.find((e) => e.episodeNumber === 1)?.id === "ep_e2_1";

  const ws = await loadWorkspace(seed.projectAId);
  const ep2 = ws?.productions.find((p) => p.episodeNumber === 2);
  report.storyboardStale = ep2?.storyboardStale === true;
  report.videoHistoryKept =
    ep2?.activeStoryboard?.videoHistoryGenerationIds?.includes("vg_e2_hist") ===
    true;
  report.videoGenCount = (await listGenerationRecords()).length;

  // 5) Engineer forbidden
  const engJar = await login(base, seed.engineer, seed.password);
  const engGen = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/text-generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(engJar),
      },
      body: JSON.stringify({
        outputKind: "script_episodes",
        brief: "",
        outlineText: after?.outlineText,
        episodeNumber: 1,
        modelKey: "balanced-default",
        targetChars: 300,
        idempotencyKey: `e2_ce_${Date.now()}`,
      }),
    },
  );
  const engSse = await readSse(engGen);
  report.engineerForbidden = engSse.errorCode === "FORBIDDEN";

  // 6) Unauthenticated
  const unauth = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/text-generations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outputKind: "script_episodes",
        brief: "",
        outlineText: after?.outlineText,
        episodeNumber: 1,
        modelKey: "balanced-default",
        targetChars: 300,
        idempotencyKey: `e2_unauth_${Date.now()}`,
      }),
    },
  );
  report.unauthStatus = unauth.status;

  report.beforeCredits = beforeCredits;
  report.ok =
    (report.unboundError === "AI_CAPABILITY_NOT_CONFIGURED" ||
      report.unboundError === "AI_CONFIGURATION_INVALID") &&
    report.unboundDraftUnchanged === true &&
    report.genParsedOk === true &&
    report.previewDidNotMutate === true &&
    report.applyStatus === 200 &&
    report.applyInvalidated === true &&
    report.afterOutlineKept === true &&
    report.afterSourceImportCleared === true &&
    report.afterEpisode2Changed === true &&
    report.storyboardStale === true &&
    report.videoHistoryKept === true &&
    report.videoGenCount === 0 &&
    report.engineerForbidden === true &&
    report.unauthStatus === 401;

  const outPath = path.join(seed.appDataDir, "e2-smoke-api-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
