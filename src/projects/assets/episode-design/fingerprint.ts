import { stableHash } from "@/projects/storyboard/hash";

export function getScriptEpisodeContentFingerprint(episode: {
  episodeNumber: number;
  title: string;
  content: string;
}): string {
  const normalizedTitle = episode.title.replace(/\r\n/g, "\n");
  const normalizedContent = episode.content.replace(/\r\n/g, "\n");
  const payload = [
    String(episode.episodeNumber),
    normalizedTitle,
    normalizedContent,
  ].join("\n");
  return stableHash(payload);
}
