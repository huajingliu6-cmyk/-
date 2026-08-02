/**
 * Guards Smoke scripts from writing into the repository's real `data/` tree.
 * Used only by Smoke CLI scripts and their unit tests — not by Next.js request paths.
 */
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const SMOKE_DIR_PREFIX = "ic-smoke-";
export const SMOKE_MARKER_FILE = ".ic-smoke-run";

export type SmokeAppDataSession = {
  appDataDir: string;
  smokeRunId: string;
  createdBySession: boolean;
  previousAppDataDir: string | undefined;
  cleanup: () => void;
};

function normalize(p: string): string {
  return path.normalize(path.resolve(p));
}

export function resolveRepoRoot(cwd: string = process.cwd()): string {
  return normalize(cwd);
}

export function resolveRepoDataDir(repoRoot: string = resolveRepoRoot()): string {
  return normalize(path.join(repoRoot, "data"));
}

function isPathEqualOrInside(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  if (c === p) return true;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(prefix);
}

function assertNotRepoPath(appDataDir: string, repoRoot: string): void {
  const repoData = resolveRepoDataDir(repoRoot);
  const resolved = normalize(appDataDir);
  if (resolved === repoRoot) {
    throw new Error("Smoke 拒绝使用仓库根目录作为 APP_DATA_DIR");
  }
  if (resolved === repoData || isPathEqualOrInside(resolved, repoData)) {
    throw new Error("Smoke 拒绝使用仓库真实 data/ 作为 APP_DATA_DIR");
  }
  if (isPathEqualOrInside(resolved, repoRoot)) {
    throw new Error("Smoke 拒绝使用仓库内路径作为 APP_DATA_DIR");
  }
}

/**
 * Refuse Smoke when APP_DATA_DIR would touch the repo or a non-smoke directory.
 */
export function assertSmokeDataDirectoryIsIsolated(
  appDataDir: string,
  options: {
    repoRoot?: string;
    smokeRunId?: string;
    requireMarker?: boolean;
  } = {},
): void {
  const repoRoot = resolveRepoRoot(options.repoRoot ?? process.cwd());
  const resolved = normalize(appDataDir);

  if (!resolved) {
    throw new Error("Smoke APP_DATA_DIR 不能为空");
  }
  assertNotRepoPath(resolved, repoRoot);

  const base = path.basename(resolved);
  if (!base.startsWith(SMOKE_DIR_PREFIX)) {
    throw new Error(
      `Smoke APP_DATA_DIR 目录名必须以 ${SMOKE_DIR_PREFIX} 开头（当前: ${base}）`,
    );
  }
  if (options.smokeRunId && !base.includes(options.smokeRunId)) {
    throw new Error("Smoke APP_DATA_DIR 未包含本次 smokeRunId");
  }
  if (options.requireMarker !== false) {
    const marker = path.join(resolved, SMOKE_MARKER_FILE);
    if (!existsSync(marker)) {
      throw new Error("Smoke APP_DATA_DIR 缺少 .ic-smoke-run 标记文件");
    }
    if (options.smokeRunId) {
      const body = readFileSync(marker, "utf-8").trim();
      if (body !== options.smokeRunId) {
        throw new Error("Smoke 标记文件与 smokeRunId 不一致");
      }
    }
  }
}

/** Refuse when APP_DATA_DIR is unset (would default to repo data/). */
export function assertSmokeAppDataDirEnvIsSet(): void {
  const raw = (process.env.APP_DATA_DIR ?? "").trim();
  if (!raw) {
    throw new Error(
      "Smoke 拒绝在 APP_DATA_DIR 未设置时运行（会默认写入仓库真实 data/）",
    );
  }
}

function writeMarker(appDataDir: string, smokeRunId: string) {
  mkdirSync(appDataDir, { recursive: true });
  writeFileSync(path.join(appDataDir, SMOKE_MARKER_FILE), smokeRunId, "utf-8");
}

function restoreEnv(previousAppDataDir: string | undefined) {
  if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
  else process.env.APP_DATA_DIR = previousAppDataDir;
}

/**
 * Create or reuse an isolated OS temp APP_DATA_DIR for Smoke.
 * Never falls through to the repository `data/` default.
 */
export function beginIsolatedSmokeAppDataSession(options?: {
  repoRoot?: string;
  /** Reuse existing APP_DATA_DIR when it already passes isolation (e.g. check after fixture). */
  reuseExistingIfIsolated?: boolean;
}): SmokeAppDataSession {
  const repoRoot = resolveRepoRoot(options?.repoRoot ?? process.cwd());
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const existingRaw = previousAppDataDir?.trim() ?? "";

  if (existingRaw) {
    const existing = normalize(existingRaw);
    // Hard refuse repo paths in every mode
    assertNotRepoPath(existing, repoRoot);

    if (options?.reuseExistingIfIsolated) {
      assertSmokeDataDirectoryIsIsolated(existing, {
        repoRoot,
        requireMarker: true,
      });
      const marker = readFileSync(
        path.join(existing, SMOKE_MARKER_FILE),
        "utf-8",
      ).trim();
      return {
        appDataDir: existing,
        smokeRunId: marker,
        createdBySession: false,
        previousAppDataDir,
        cleanup: () => restoreEnv(previousAppDataDir),
      };
    }
  } else if (options?.reuseExistingIfIsolated) {
    assertSmokeAppDataDirEnvIsSet();
  }

  const smokeRunId = randomBytes(8).toString("hex");
  // Prefer ASCII-only base to avoid Windows 8.3 short-path encoding issues with non-ASCII usernames.
  const asciiBase = process.env.SMOKE_ASCII_TMP || "C:\\Temp";
  mkdirSync(asciiBase, { recursive: true });
  const appDataDir = mkdtempSync(
    path.join(asciiBase, `${SMOKE_DIR_PREFIX}${smokeRunId}-`),
  );
  writeMarker(appDataDir, smokeRunId);
  assertSmokeDataDirectoryIsIsolated(appDataDir, {
    repoRoot,
    smokeRunId,
    requireMarker: true,
  });
  process.env.APP_DATA_DIR = appDataDir;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    restoreEnv(previousAppDataDir);
    const target = normalize(appDataDir);
    if (!path.basename(target).startsWith(SMOKE_DIR_PREFIX)) {
      throw new Error("拒绝清理非 Smoke 临时目录");
    }
    assertNotRepoPath(target, repoRoot);
    rmSync(target, { recursive: true, force: true });
  };

  return {
    appDataDir,
    smokeRunId,
    createdBySession: true,
    previousAppDataDir,
    cleanup,
  };
}
