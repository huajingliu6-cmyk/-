"use client";

import { useMemo, useState } from "react";
import { StoryboardGlobalSettingsDialog } from "@/projects/storyboard/components/StoryboardGlobalSettingsDialog";
import { StoryboardProductionPanel } from "@/projects/storyboard/components/StoryboardProductionPanel";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import type { ShotVideoHistoryItem } from "@/projects/storyboard/shot-video-history";
import {
  defaultStoryboardVideoDefaults,
  type StoryboardVideoDefaults,
} from "@/projects/storyboard/storyboard-video-params";
import type {
  EpisodeProduction,
  StoryboardScene,
  StoryboardShot,
} from "@/projects/storyboard/types";
import "@/projects/storyboard/storyboard-workspace.css";

const VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

const assetImages = {
  character1:
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=420&q=82",
  character2:
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=420&q=82",
  character3:
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=420&q=82",
  scene1:
    "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=720&q=82",
  scene2:
    "https://images.unsplash.com/photo-1449157291145-7efd050a4d0e?auto=format&fit=crop&w=720&q=82",
  prop1:
    "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=420&q=82",
  prop2:
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=420&q=82",
} as const;

function asset(
  id: string,
  name: string,
  kind: PickerAsset["kind"],
  thumbUrl: string,
): PickerAsset {
  return { id, name, kind, thumbUrl };
}

const assets: PickerAsset[] = [
  asset("char-lin", "林清 · 夜行造型", "character", assetImages.character1),
  asset("char-shen", "沈砚 · 黑衣造型", "character", assetImages.character2),
  asset("char-qi", "齐岳 · 校服造型", "character", assetImages.character3),
  asset("scene-campus", "北辰大学校史馆外", "scene", assetImages.scene1),
  asset("scene-hall", "校史馆长廊", "scene", assetImages.scene2),
  asset("prop-umbrella", "黑色长柄伞", "prop", assetImages.prop1),
  asset("prop-notebook", "旧笔记本", "prop", assetImages.prop2),
];

function requirement(
  requirementId: string,
  type: "character" | "scene" | "prop",
  sourceName: string,
  selectedAssetId: string,
) {
  return {
    requirementId,
    type,
    sourceName,
    normalizedName: sourceName,
    selectedAssetId,
    resolution: "LINKED" as const,
    manuallyAdded: false,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
  };
}

function shot(
  id: string,
  shotNumber: number,
  sceneAssetId: string,
  characterAssetIds: string[],
  propAssetIds: string[],
  prompt: string,
  durationSeconds: number,
): StoryboardShot {
  return {
    id,
    shotNumber,
    durationSeconds,
    shotSize: shotNumber % 2 ? "全景" : "中近景",
    cameraAngle: "平视",
    cameraMovement: shotNumber % 2 ? "缓慢推进" : "跟随移动",
    composition: "主体位于画面中心，前景保留树影与雨幕层次。",
    visualDescription: prompt,
    actionDescription: "人物穿过雨夜场地，回头确认身后动静。",
    dialogue: shotNumber % 2 ? "" : "就是这里。",
    soundEffect: "雨声、远处汽车驶过的低频声。",
    music: "低沉弦乐渐入。",
    shotSummary: prompt,
    promptDraft: "",
    videoPrompt: `画面风格和类型：真人写实，电影级风格，冷色调。\n${prompt}\n镜头运动：${shotNumber % 2 ? "缓慢推进" : "跟随移动"}。\n环境声音：雨声与远处车流。`,
    lastVideoContentHash: "preview-hash",
    lastGenerationId: `preview-generation-${id}`,
    videoHistoryGenerationIds: [`preview-generation-${id}`],
    videoContentStale: false,
    requiredCharacters: characterAssetIds.map(
      (assetId) => assets.find((item) => item.id === assetId)?.name ?? assetId,
    ),
    requiredProps: propAssetIds.map(
      (assetId) => assets.find((item) => item.id === assetId)?.name ?? assetId,
    ),
    requiredScene:
      assets.find((item) => item.id === sceneAssetId)?.name ?? sceneAssetId,
    characterAssetIds,
    sceneAssetIds: [sceneAssetId],
    sceneAssetId,
    propAssetIds,
    audioAssetIds: [],
    assetMediaIds: {},
    requirements: [
      ...characterAssetIds.map((assetId, index) =>
        requirement(
          `${id}-character-${index}`,
          "character",
          assets.find((item) => item.id === assetId)?.name ?? assetId,
          assetId,
        ),
      ),
      requirement(
        `${id}-scene`,
        "scene",
        assets.find((item) => item.id === sceneAssetId)?.name ?? sceneAssetId,
        sceneAssetId,
      ),
      ...propAssetIds.map((assetId, index) =>
        requirement(
          `${id}-prop-${index}`,
          "prop",
          assets.find((item) => item.id === assetId)?.name ?? assetId,
          assetId,
        ),
      ),
    ],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: true,
    revision: 1,
    order: shotNumber - 1,
    promptRegenJobId: null,
  };
}

function history(shotId: string, version: number): ShotVideoHistoryItem {
  const completedAt = `2026-08-${String(10 + version).padStart(2, "0")}T09:30:00.000Z`;
  return {
    id: `preview-video-${shotId}-${version}`,
    videoUrl: VIDEO_URL,
    downloadUrl: VIDEO_URL,
    completedAt,
    actualDurationSeconds: version === 1 ? 6 : 5,
    actualResolution: "720P",
    providerModelId: "preview",
    isMock: true,
    versionLabel: `版本 ${version}`,
  };
}

function createPreviewProduction(): EpisodeProduction {
  const scenes: StoryboardScene[] = [
    {
      id: "scene-1",
      sceneNumber: 1,
      title: "校史馆外 · 雨夜",
      location: "北辰大学校史馆外",
      timeOfDay: "夜",
      interiorExterior: "EXT",
      summary: "林清在雨夜抵达校史馆，发现旧钟楼亮起微光。",
      characterAssetIds: ["char-lin", "char-shen"],
      sceneAssetIds: ["scene-campus"],
      propAssetIds: ["prop-umbrella"],
      order: 0,
      confirmed: true,
      shots: [
        shot(
          "shot-1",
          1,
          "scene-campus",
          ["char-lin", "char-shen"],
          ["prop-umbrella"],
          "夜幕下的北辰大学校史馆外，林清撑黑伞走上湿润石阶，远处钟楼被雨雾包围。",
          6,
        ),
        shot(
          "shot-2",
          2,
          "scene-campus",
          ["char-lin"],
          ["prop-umbrella", "prop-notebook"],
          "镜头贴近林清的侧脸，她在台阶前停下，手中的旧笔记本被雨水打湿。",
          8,
        ),
        shot(
          "shot-3",
          3,
          "scene-campus",
          ["char-shen", "char-qi"],
          [],
          "沈砚与齐岳从树影中走出，站在校史馆门口交换一个克制而紧张的眼神。",
          5,
        ),
      ],
    },
    {
      id: "scene-2",
      sceneNumber: 2,
      title: "校史馆内 · 长廊",
      location: "校史馆长廊",
      timeOfDay: "夜",
      interiorExterior: "INT",
      summary: "三人进入长廊，旧照片和脚步声把秘密推向前景。",
      characterAssetIds: ["char-lin", "char-shen"],
      sceneAssetIds: ["scene-hall"],
      propAssetIds: ["prop-notebook"],
      order: 1,
      confirmed: true,
      shots: [
        shot(
          "shot-4",
          4,
          "scene-hall",
          ["char-lin", "char-shen"],
          ["prop-notebook"],
          "长廊灯光忽明忽暗，林清翻开旧笔记本，墙上泛黄的照片与她手中的线索形成呼应。",
          7,
        ),
        shot(
          "shot-5",
          5,
          "scene-hall",
          ["char-lin"],
          ["prop-notebook"],
          "林清抬头望向长廊尽头的玻璃门，门后有一道短暂掠过的影子。",
          4,
        ),
      ],
    },
  ];

  return {
    id: "preview-production",
    projectId: "storyboard-layout-preview",
    episodeId: "episode-1",
    episodeNumber: 1,
    currentStep: 2,
    status: "storyboard_done",
    workingScriptText: "林清在雨夜回到北辰大学校史馆，试图找出父亲失踪前留下的最后线索。",
    workingScriptRevision: 1,
    confirmedScriptText: "林清在雨夜回到北辰大学校史馆，试图找出父亲失踪前留下的最后线索。",
    confirmedScriptRevision: 1,
    confirmedScriptHash: "preview-script",
    scriptConfirmedAt: "2026-08-01T08:00:00.000Z",
    scriptConfirmedBy: "preview",
    assetMatches: [],
    confirmedAssetSnapshotHash: "preview-assets",
    assetsConfirmedAt: "2026-08-01T08:00:00.000Z",
    assetsConfirmedBy: "preview",
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: {
      id: "preview-storyboard",
      version: 1,
      status: "confirmed",
      sourceScriptHash: "preview-script",
      sourceAssetSnapshotHash: "preview-assets",
      generationJobId: null,
      scenes,
      videoHistoryGenerationIds: scenes.flatMap((scene) =>
        scene.shots.map((currentShot) => `preview-generation-${currentShot.id}`),
      ),
      confirmedAt: "2026-08-01T08:00:00.000Z",
      confirmedBy: "preview",
      revision: 1,
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    },
    generationError: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: "2026-08-01T08:00:00.000Z",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
  };
}

export default function StoryboardLayoutPreviewPage() {
  const [production, setProduction] = useState(createPreviewProduction);
  const [note, setNote] = useState("预览模式：点击底部镜头卡可切换当前分镜。");
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [videoDefaults, setVideoDefaults] = useState<StoryboardVideoDefaults>(
    defaultStoryboardVideoDefaults,
  );

  const previewVideosByShotId = useMemo(() => {
    const allShots = production.activeStoryboard?.scenes.flatMap((scene) => scene.shots) ?? [];
    return Object.fromEntries(
      allShots.map((currentShot) => [
        currentShot.id,
        [history(currentShot.id, 1), ...(currentShot.id === "shot-1" ? [history(currentShot.id, 2)] : [])],
      ]),
    );
  }, [production.activeStoryboard]);

  return (
    <div className="sbw">
      <div className="sbw-inner">
        <header className="sbw-head">
          <div className="sbw-head__titles">
            <h1>分镜创作</h1>
            <p>布局预览 · 第 1 集 · {note}</p>
          </div>
          <div className="sbw-head__actions">
            <button
              type="button"
              className="sbw-link"
              data-testid="storyboard-global-settings-btn"
              onClick={() => setGlobalSettingsOpen(true)}
            >
              全局设置
            </button>
            <span className="sbw-badge">所有人可协作</span>
            <button type="button" className="sbw-btn sbw-btn-primary">
              保存页面
            </button>
          </div>
        </header>

        <main className="sbw-layout">
          <StoryboardProductionPanel
            projectId="storyboard-layout-preview"
            production={production}
            assets={assets}
            onProductionChange={setProduction}
            onAssetsRefresh={() => undefined}
            onNote={setNote}
            canGenerateVideo
            videoDefaults={videoDefaults}
            previewMode
            previewVideosByShotId={previewVideosByShotId}
          />
        </main>
      </div>
      <StoryboardGlobalSettingsDialog
        open={globalSettingsOpen}
        initial={videoDefaults}
        onClose={() => setGlobalSettingsOpen(false)}
        onSave={(next) => {
          setVideoDefaults(next);
          setGlobalSettingsOpen(false);
          setNote("全局设置已保存。各分镜仍可单独调整参数。");
        }}
      />
    </div>
  );
}
