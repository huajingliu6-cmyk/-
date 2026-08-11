import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  EPISODE_DRAWER_CLOSE_DELAY_MS,
  STORYBOARD_EPISODES_PER_PAGE,
  pageForEpisodeId,
} from "@/projects/storyboard/components/EpisodeSidebar";
import type { ScriptEpisode } from "@/projects/script/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

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

describe("storyboard episode drawer UI contract", () => {
  const sidebar = readSrc(
    "src/projects/storyboard/components/EpisodeSidebar.tsx",
  );
  const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
  const workspace = readSrc(
    "src/projects/storyboard/StoryboardCreationWorkspace.tsx",
  );

  it("uses a fixed left hover/focus drawer without a second episode list", () => {
    expect(workspace).toContain("EpisodeSidebar");
    expect(workspace.match(/<EpisodeSidebar\b/g)?.length).toBe(1);
    expect(sidebar).toContain("sbw-episode-drawer");
    expect(sidebar).toContain("episode-sidebar-handle");
    expect(sidebar).toContain("episode-sidebar-drawer");
    expect(sidebar).toContain("剧集列表");
    expect(sidebar).toContain("List");
    expect(sidebar).toContain("storyboard-episode-trigger");
    expect(sidebar).toContain("onMouseEnter");
    expect(sidebar).toContain("onMouseLeave");
    expect(sidebar).toContain("onFocusCapture");
    expect(sidebar).toContain("scheduleClose");
    expect(EPISODE_DRAWER_CLOSE_DELAY_MS).toBe(250);
  });

  it("keeps drawer fixed to the viewport with internal scroll and below modals", () => {
    expect(css).toMatch(/\.sbw-episode-drawer\s*\{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.sbw-episode-drawer\s*\{[\s\S]*?top:\s*50%/);
    expect(css).toMatch(
      /\.sbw-episode-drawer\s*\{[\s\S]*?transform:\s*translateY\(-50%\)/,
    );
    expect(css).toMatch(/\.sbw-episode-drawer\s*\{[\s\S]*?z-index:\s*1200/);
    expect(css).toMatch(
      /\.sbw-episode-drawer__body\s*\{[\s\S]*?overflow-y:\s*auto/,
    );
    expect(css).toContain(".storyboard-episode-trigger");
    expect(css).toMatch(
      /\.storyboard-episode-trigger[\s\S]*?width:\s*36px/,
    );
    expect(css).toMatch(
      /\.storyboard-episode-trigger[\s\S]*?height:\s*104px/,
    );
    expect(css).toMatch(
      /text-orientation:\s*upright/,
    );
    expect(css).toContain("episode-trigger-gradient");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toMatch(/align-self:\s*center/);
    expect(css).toMatch(/\.sbw-layout\s*\{[\s\S]*?minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.sbw-modal-backdrop\s*\{[\s\S]*?z-index:\s*2400/);
  });
});
