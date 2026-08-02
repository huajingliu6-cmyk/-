import path from "path";

/**
 * Application data root for legacy JSON / local file stores.
 *
 * Override with `APP_DATA_DIR` or `DATA_ROOT` (absolute, or relative to cwd).
 * Vitest must set `APP_DATA_DIR` to an isolated temp directory so tests never
 * read/write the repository `data/` tree.
 */
export function getAppDataDir(): string {
  if (process.env.NODE_ENV === 'production' || process.env.REMOTE_DATA_ONLY === 'true') {
    throw new Error('LOCAL_PERSISTENCE_FORBIDDEN');
  }
  const raw = (process.env.APP_DATA_DIR ?? process.env.DATA_ROOT ?? "").trim();
  if (raw) {
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw);
  }
  return path.join(process.cwd(), "data");
}

/** Join segments under the application data root. */
export function resolveAppDataPath(...segments: string[]): string {
  return path.join(getAppDataDir(), ...segments);
}
