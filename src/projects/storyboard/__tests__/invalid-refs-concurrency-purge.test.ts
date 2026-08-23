import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  attachAssetBundleRevision,
  assetBundleDocumentRevision,
} from "@/projects/assets/asset-bundle-revision";
import type { CharacterAsset } from "@/projects/assets/types";
import type { AuthUser } from "@/auth/types";
import { buildInvalidRefRepairPreview } from "@/projects/storyboard/invalid-refs/apply";
import { scanInvalidStoryboardRefs } from "@/projects/storyboard/invalid-refs/scan";
import {
  newPreviewId,
  purgeExpiredInvalidRefPreviews,
  saveInvalidRefPreviewRecord,
} from "@/projects/storyboard/invalid-refs/preview-store";
import { handleInvalidRefsApply } from "@/projects/storyboard/invalid-refs/route-handlers";
import { withProjectStoryboardLock } from "@/projects/storyboard/production-lock";
import {
  loadWorkspace,
  saveWorkspace,
  storyboardRemoteRevision,
  updateWorkspaceUnderLock,
} from "@/projects/storyboard/production-store";
import { projectRootDir } from "@/projects/project-storage";
import type {
  ProjectStoryboardWorkspace,
  StoryboardShot,
} from "@/projects/storyboard/types";

vi.mock("@/projects/assets/asset-image-storage", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/projects/assets/asset-image-storage")
    >();
  return {
    ...actual,
    readProjectAssetImageFile: vi.fn(async () => ({
      buffer: Buffer.from("x"),
      mimeType: "image/png",
    })),
  };
});

vi.mock("@/projects/storyboard/api-helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/projects/storyboard/api-helpers")>();
  return {
    ...actual,
    loadAuthorizedWorkspace: vi.fn(),
  };
});

import { loadAuthorizedWorkspace } from "@/projects/storyboard/api-helpers";

function cert(mediaId: string) {
  return {
    [mediaId]: {
      status: "ok" as const,
      checkedAt: "2026-01-01T00:00:00.000Z",
      modelId: SD2_CERT_MODEL_TAG,
    },
  };
}

function authUser(id = "u_concurrency"): AuthUser {
  return {
    id,
    username: id,
    role: "user",
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function character(
  projectId: string,
  partial: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "char_1",
    projectId,
    name: "江宸",
    role: "主角",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: "v1",
    voiceName: "V",
    voiceStyle: null,
    imageFileName: "gen_primary",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "gen_primary",
    lookMediaIds: ["gen_look_b"],
    historyMediaIds: [],
    approvedMediaIds: ["gen_primary", "gen_look_b"],
    mediaVideoRefSafety: {
      ...cert("gen_primary"),
      ...cert("gen_look_b"),
    },
    ...partial,
  };
}

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "",
    visualDescription: "",
    actionDescription: "",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "",
    videoPrompt: "",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: [],
    requiredProps: [],
    requiredScene: null,
    characterAssetIds: ["char_1"],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    assetMediaIds: { char_1: "gen_look_a" },
    requirements: [],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: false,
    revision: 1,
    order: 0,
    promptRegenJobId: null,
    ...overrides,
  };
}

function workspaceFixture(projectId: string): ProjectStoryboardWorkspace {
  return {
    projectId,
    activeEpisodeId: "ep1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    productions: [
      {
        id: "prod_ep1",
        projectId,
        episodeId: "ep1",
        episodeNumber: 1,
        currentStep: 2,
        status: "storyboard_incomplete",
        workingScriptText: "",
        workingScriptRevision: 1,
        confirmedScriptText: "",
        confirmedScriptRevision: 1,
        confirmedScriptHash: "h",
        scriptConfirmedAt: "2026-01-01T00:00:00.000Z",
        scriptConfirmedBy: "u1",
        assetMatches: [],
        confirmedAssetSnapshotHash: null,
        assetsConfirmedAt: null,
        assetsConfirmedBy: null,
        assetsStale: false,
        storyboardStale: false,
        generationError: null,
        videoGenerationBatch: null,
        revision: 1,
        lastEditedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        activeStoryboard: {
          id: "sb_ep1",
          status: "ready",
          revision: 1,
          sourceScriptHash: "",
          sourceAssetSnapshotHash: "",
          generationJobId: null,
          version: 1,
          videoHistoryGenerationIds: [],
          confirmedAt: null,
          confirmedBy: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          scenes: [
            {
              id: "scene_ep1",
              sceneNumber: 1,
              title: "场1",
              location: "",
              timeOfDay: "",
              interiorExterior: "未知",
              summary: "",
              characterAssetIds: ["char_1"],
              propAssetIds: [],
              sceneAssetIds: [],
              order: 0,
              confirmed: false,
              shots: [baseShot()],
            },
          ],
        },
      },
    ],
  };
}

function assetsFixture(projectId: string): AssetBundleDraft {
  return {
    projectId,
    characters: [character(projectId)],
    scenes: [],
    props: [],
    audios: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function seedPreview(input: {
  projectId: string;
  userId: string;
  store: "management" | "workspace";
  workspace: ProjectStoryboardWorkspace;
  assets: AssetBundleDraft;
}) {
  const scan = scanInvalidStoryboardRefs({
    workspace: input.workspace,
    assetsDraft: input.assets,
    scope: "episode",
    episodeId: "ep1",
  });
  const issueId = scan.episodes[0]!.issues[0]!.issueId;
  const previewId = newPreviewId();
  const built = buildInvalidRefRepairPreview({
    scan,
    workspace: input.workspace,
    assetsDraft: input.assets,
    mediaSelections: [{ issueId, mediaId: "gen_look_b" }],
    store: input.store,
    previewId,
    productionDocumentRevision:
      storyboardRemoteRevision(input.workspace) ?? 0,
    assetDocumentRevision: assetBundleDocumentRevision(input.assets) ?? 0,
    projectConsistencyRevision: 0,
  });
  expect(built.canConfirm).toBe(true);
  await saveInvalidRefPreviewRecord({
    previewId: built.previewId,
    planDigest: built.planDigest,
    snapshotDigest: built.snapshotDigest,
    projectId: input.projectId,
    userId: input.userId,
    store: input.store,
    scope: "episode",
    episodeId: "ep1",
    mediaSelections: built.mediaSelections,
    shotChanges: built.shotChanges,
    snapshot: built.snapshot,
  });
  return built;
}

describe("invalid-refs concurrency + preview purge", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  let tmp: string;
  let projectId: string;
  let user: AuthUser;

  beforeEach(async () => {
    const root =
      process.env.IC_TEST_TMP_ROOT ||
      path.join("E:", "DevWorkspace", "runtime", "test-tmp");
    mkdirSync(root, { recursive: true });
    tmp = mkdtempSync(path.join(root, "ic-irp-lock-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
    projectId = `p_lock_${Date.now()}`;
    user = authUser();
    mkdirSync(projectRootDir(projectId), { recursive: true });

    await saveWorkspace(workspaceFixture(projectId));
    await saveAssetBundleDraft(
      attachAssetBundleRevision(assetsFixture(projectId), 0),
    );
    const loadedWs = (await loadWorkspace(projectId))!;
    const loadedAssets = (await loadAssetBundleDraft(projectId))!;

    vi.mocked(loadAuthorizedWorkspace).mockResolvedValue({
      ok: true,
      context: {
        project: { projectId, name: "lock-test" },
        episodes: [
          {
            id: "ep1",
            projectId,
            episodeNumber: 1,
            title: "第一集",
            content: "",
            wordCount: 0,
            status: "saved",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        workspace: loadedWs,
        assetsDraft: loadedAssets,
      },
    });
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("second concurrent apply cannot overwrite after first write; returns PREVIEW_STALE", async () => {
    const ws = (await loadWorkspace(projectId))!;
    const assets = (await loadAssetBundleDraft(projectId))!;
    const previewA = await seedPreview({
      projectId,
      userId: user.id,
      store: "management",
      workspace: ws,
      assets,
    });
    const previewB = await seedPreview({
      projectId,
      userId: user.id,
      store: "management",
      workspace: ws,
      assets,
    });

    const first = await handleInvalidRefsApply({
      projectId,
      user,
      store: "management",
      body: {
        confirm: true,
        previewId: previewA.previewId,
        planDigest: previewA.planDigest,
      },
    });
    expect(first.status).toBe(200);

    const second = await handleInvalidRefsApply({
      projectId,
      user,
      store: "management",
      body: {
        confirm: true,
        previewId: previewB.previewId,
        planDigest: previewB.planDigest,
      },
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code?: string }).code).toBe(
      "PREVIEW_STALE",
    );
  });

  it("apply waiting on lock re-reads and rejects when production changed during wait", async () => {
    const ws = (await loadWorkspace(projectId))!;
    const assets = (await loadAssetBundleDraft(projectId))!;
    const preview = await seedPreview({
      projectId,
      userId: user.id,
      store: "management",
      workspace: ws,
      assets,
    });

    let releaseHold!: () => void;
    const holdGate = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let applyStarted = false;

    const holder = withProjectStoryboardLock(projectId, async () => {
      while (!applyStarted) {
        await new Promise((r) => setTimeout(r, 5));
      }
      await updateWorkspaceUnderLock(projectId, async (latest) => {
        if (!latest) return null;
        return {
          ...latest,
          productions: latest.productions.map((p) => ({
            ...p,
            revision: p.revision + 1,
            activeStoryboard: p.activeStoryboard
              ? {
                  ...p.activeStoryboard,
                  revision: p.activeStoryboard.revision + 1,
                  scenes: p.activeStoryboard.scenes.map((scene) => ({
                    ...scene,
                    shots: scene.shots.map((shot) => ({
                      ...shot,
                      visualDescription: "concurrent-edit",
                      revision: shot.revision + 1,
                    })),
                  })),
                }
              : null,
          })),
        };
      });
      await holdGate;
    });

    await new Promise((r) => setTimeout(r, 20));
    applyStarted = true;
    const applyPromise = handleInvalidRefsApply({
      projectId,
      user,
      store: "management",
      body: {
        confirm: true,
        previewId: preview.previewId,
        planDigest: preview.planDigest,
      },
    });

    await new Promise((r) => setTimeout(r, 40));
    releaseHold();
    await holder;

    const response = await applyPromise;
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "PREVIEW_STALE",
    );
    const loaded = await loadWorkspace(projectId);
    expect(
      loaded?.productions[0]?.activeStoryboard?.scenes[0]?.shots[0]
        ?.visualDescription,
    ).toBe("concurrent-edit");
  });

  it("purges expired invalid-ref previews only; keeps live previews and non-preview files", async () => {
    const dir = path.join(
      projectRootDir(projectId),
      "drafts",
      "invalid-ref-previews",
    );
    mkdirSync(dir, { recursive: true });
    const draftsDir = path.join(projectRootDir(projectId), "drafts");
    writeFileSync(
      path.join(draftsDir, "asset-name-change-hints.json"),
      JSON.stringify({ keep: true }),
      "utf-8",
    );
    writeFileSync(path.join(dir, "not-a-preview.txt"), "keep", "utf-8");
    writeFileSync(
      path.join(dir, "weird_name.json"),
      JSON.stringify({ previewId: "weird_name", projectId }),
      "utf-8",
    );

    const expiredId = "irp_expired00000000001";
    const liveId = "irp_live00000000000001";
    const now = Date.now();
    writeFileSync(
      path.join(dir, `${expiredId}.json`),
      JSON.stringify({
        previewId: expiredId,
        projectId,
        expiresAt: new Date(now - 60_000).toISOString(),
        planDigest: "x",
      }),
      "utf-8",
    );
    writeFileSync(
      path.join(dir, `${liveId}.json`),
      JSON.stringify({
        previewId: liveId,
        projectId,
        expiresAt: new Date(now + 3_600_000).toISOString(),
        planDigest: "y",
      }),
      "utf-8",
    );

    const result = await purgeExpiredInvalidRefPreviews(projectId, now);
    expect(result.deleted).toBe(1);
    expect(result.scanned).toBe(2);
    expect(() => readFileSync(path.join(dir, `${expiredId}.json`))).toThrow();
    expect(readFileSync(path.join(dir, `${liveId}.json`), "utf-8")).toContain(
      liveId,
    );
    expect(readFileSync(path.join(dir, "not-a-preview.txt"), "utf-8")).toBe(
      "keep",
    );
    expect(
      readFileSync(
        path.join(draftsDir, "asset-name-change-hints.json"),
        "utf-8",
      ),
    ).toContain("keep");
  });
});
