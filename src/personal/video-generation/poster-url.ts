export function isPersonalVideoImagePosterUrl(
  url: string | null | undefined,
): boolean {
  if (!url?.trim()) return false;
  const value = url.trim();
  if (value.includes("/api/materials/media/")) return true;
  if (value.includes("/api/assets/")) return false;
  if (value.includes("/api/generated-videos/")) return false;
  if (/\.(mp4|webm|mov)(\?|#|$)/i.test(value)) return false;
  return true;
}

export function normalizePersonalVideoPosterUrl(
  posterUrl: string | null | undefined,
  videoUrl: string | null | undefined,
): string | null {
  if (!posterUrl?.trim()) return null;
  const normalized = posterUrl.trim();
  if (videoUrl && normalized === videoUrl.trim()) return null;
  return isPersonalVideoImagePosterUrl(normalized) ? normalized : null;
}

export function personalVideoPreviewSeekSrc(url: string): string {
  if (!url.trim()) return url;
  return url.includes("#") ? url : `${url}#t=0.1`;
}
