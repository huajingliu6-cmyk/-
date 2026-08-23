/** Central config for workspace local assets.json size guard. */
export const WORKSPACE_LOCAL_ASSETS_MAX_BYTES_ENV =
  "WORKSPACE_LOCAL_ASSETS_MAX_BYTES";

/** Default 32 MiB — sparse overrides should stay far below this. */
export const WORKSPACE_LOCAL_ASSETS_MAX_BYTES_DEFAULT = 32 * 1024 * 1024;

export function getWorkspaceLocalAssetsMaxBytes(): number {
  const raw = process.env[WORKSPACE_LOCAL_ASSETS_MAX_BYTES_ENV]?.trim();
  if (!raw) return WORKSPACE_LOCAL_ASSETS_MAX_BYTES_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return WORKSPACE_LOCAL_ASSETS_MAX_BYTES_DEFAULT;
  }
  return Math.floor(n);
}

export class WorkspaceMaterializeTooLargeError extends Error {
  readonly code = "WORKSPACE_MATERIALIZE_TOO_LARGE" as const;
  readonly byteLength: number;
  readonly maxBytes: number;
  readonly assetCount: number;

  constructor(
    message: string,
    details: { byteLength: number; maxBytes: number; assetCount: number },
  ) {
    super(message);
    this.name = "WorkspaceMaterializeTooLargeError";
    this.byteLength = details.byteLength;
    this.maxBytes = details.maxBytes;
    this.assetCount = details.assetCount;
  }
}
