import { describe, expect, it } from "vitest";
import {
  STORYBOARD_EPISODES_PER_PAGE,
  pageForEpisodeId,
} from "@/projects/storyboard/components/EpisodeSidebar";
import type { ScriptEpisode } from "@/projects/script/types";

function makeEpisodes(count: number): ScriptEpisode[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `ep_${index + 1}`,
    projectId: "p1",
    episodeNumber: index + 1,
    title: `第${index + 1}集`,
    content: "x",
    wordCount: 1,
    status: "saved",
    createdAt: now,
    updatedAt: now,
  }));
}

describe("storyboard episode sidebar paging", () => {
  it("uses 10 episodes per page", () => {
    expect(STORYBOARD_EPISODES_PER_PAGE).toBe(10);
  });

  it("maps episode ids to the correct page", () => {
    const episodes = makeEpisodes(25);
    expect(pageForEpisodeId(episodes, "ep_1")).toBe(1);
    expect(pageForEpisodeId(episodes, "ep_10")).toBe(1);
    expect(pageForEpisodeId(episodes, "ep_11")).toBe(2);
    expect(pageForEpisodeId(episodes, "ep_25")).toBe(3);
  });
});
