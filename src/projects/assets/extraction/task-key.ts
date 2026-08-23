export function allAssetsTaskKey(
  projectId: string,
  sourceFingerprint: string,
): string {
  return `${projectId}:${sourceFingerprint}:all-assets`;
}

export function episodeAssetsTaskKey(
  projectId: string,
  sourceFingerprint: string,
  episodeId: string,
): string {
  return `${projectId}:${sourceFingerprint}:episode-assets:${episodeId}`;
}
