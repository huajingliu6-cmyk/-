import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  loadWorkspace,
  normalizeWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import type { ScriptEpisode } from "@/projects/script/types";

describe("production-store", () => {
  const projectId = "p_storyboard_store_test";

  const episodes: ScriptEpisode[] = [
    {
      id: "ep_1",
      projectId,
      episodeNumber: 1,
      title: "第一集",
      content: "开场",
      wordCount: 2,
      status: "saved",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("normalizes workspace payloads defensively", () => {
    const ws = normalizeWorkspace(projectId, {
      productions: [
        {
          id: "prod_1",
          episodeId: "ep_1",
          episodeNumber: 1,
          status: "awaiting_script",
          workingScriptText: "你好",
        },
      ],
      activeEpisodeId: "ep_1",
    });
    expect(ws?.projectId).toBe(projectId);
    expect(ws?.productions).toHaveLength(1);
    expect(ws?.productions[0]?.workingScriptText).toBe("你好");
    expect(ws?.activeEpisodeId).toBe("ep_1");
  });

  it("persists workspace atomically under APP_DATA_DIR", async () => {
    const ensured = ensureEpisodeProductions(projectId, episodes, null);
    const saved = await saveWorkspace(ensured);
    expect(saved.productions).toHaveLength(1);
    expect(saved.productions[0]?.status).toBe("awaiting_script");

    const loaded = await loadWorkspace(projectId);
    expect(loaded?.projectId).toBe(projectId);
    expect(loaded?.productions[0]?.episodeId).toBe("ep_1");

    const filePath = path.join(
      resolveAppDataPath("projects", projectId, "drafts"),
      "storyboard-production.json",
    );
    const raw = await fs.readFile(filePath, "utf-8");
    expect(filePath.endsWith("storyboard-production.json")).toBe(true);
    expect(raw).toContain("ep_1");
  });

  it("ensureEpisodeProductions keeps orphan productions", () => {
    const existing = normalizeWorkspace(projectId, {
      productions: [
        {
          id: "prod_orphan",
          episodeId: "ep_removed",
          episodeNumber: 99,
          status: "storyboard_done",
          workingScriptText: "旧集",
          lastEditedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "prod_1",
          episodeId: "ep_1",
          episodeNumber: 1,
          status: "awaiting_script",
          workingScriptText: "第一集",
        },
      ],
      activeEpisodeId: "ep_1",
    });
    const next = ensureEpisodeProductions(projectId, episodes, existing);
    expect(next.productions.some((p) => p.episodeId === "ep_removed")).toBe(true);
    expect(next.productions.filter((p) => p.episodeId === "ep_1")).toHaveLength(1);
  });
});
