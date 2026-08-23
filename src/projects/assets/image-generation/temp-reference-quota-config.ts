/** Central config for temporary reference image project quota (bytes). */
export const TEMP_REFERENCE_QUOTA_ENV = "IMAGE_TEMP_REFERENCE_QUOTA_BYTES";

/** Default 200 MiB per project for tmpref_* blobs. */
export const TEMP_REFERENCE_QUOTA_BYTES_DEFAULT = 200 * 1024 * 1024;

export function getTempReferenceQuotaBytes(): number {
  const raw = process.env[TEMP_REFERENCE_QUOTA_ENV]?.trim();
  if (!raw) return TEMP_REFERENCE_QUOTA_BYTES_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return TEMP_REFERENCE_QUOTA_BYTES_DEFAULT;
  return Math.floor(n);
}
