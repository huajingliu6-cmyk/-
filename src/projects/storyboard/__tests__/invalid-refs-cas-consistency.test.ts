import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import path from "path";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  ASSET_REVISION_REQUIRED,
  attachAssetBundleRevision,
  assetBundleDocumentRevision,
  carryAssetBundleRevision,
} from "@/projects/assets/asset-bundle-revision";
import type { CharacterAsset } from "@/projects/assets/types";
import type { AuthUser } from "@/auth/types";
import { buildInvalidRefRepairPreview } from "@/projects/storyboard/invalid-refs/apply";
import { scanInvalidStoryboardRefs } from "@/projects/storyboard/invalid-refs/scan";
import {
  newPreviewId,
  saveInvalidRefPreviewRecord,
} from "@/projects/storyboard/invalid-refs/preview-store";
import { handleInvalidRefsApply } from "@/projects/storyboard/invalid-refs/route-handlers";
import { withProjectStoryboardLock } from "@/projects/storyboard/production-lock";
import {
  PRODUCTION_REVISION_CONFLICT,
  PRODUCTION_REVISION_REQUIRED,
  loadWorkspace,
  saveWorkspace,
  saveWorkspaceDocumentCas,
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

function authUser(id = "u_cas"): AuthUser {
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

describe("production CAS + asset consistency for invalid-refs", () => {
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
    tmp = mkdtempSync(path.join(root, "ic-cas-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
    projectId = `p_cas_${Date.now()}`;
    user = authUser();
    mkdirSync(projectRootDir(projectId), { recursive: true });

    const ws = workspaceFixture(projectId);
    const assets = assetsFixture(projectId);
    await saveWorkspace(ws);
    await saveAssetBundleDraft(attachAssetBundleRevision(assets, 0));

    const loadedWs = (await loadWorkspace(projectId))!;
    const loadedAssets = (await loadAssetBundleDraft(projectId))!;

    vi.mocked(loadAuthorizedWorkspace).mockResolvedValue({
      ok: true,
      context: {
        project: { projectId, name: "cas-test" },
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

  it("rejects production save without revision (no silent overwrite)", async () => {
    const blind = workspaceFixture(projectId);
    await expect(saveWorkspaceDocumentCas(blind)).rejects.toThrow(
      PRODUCTION_REVISION_REQUIRED,
    );
    const before = (await loadWorkspace(projectId))!;
    const replayed = await saveWorkspace(blind);
    expect(storyboardRemoteRevision(replayed)).toBe(
      storyboardRemoteRevision(before),
    );
  });

  it("rejects production save with stale revision", async () => {
    const first = (await loadWorkspace(projectId))!;
    await saveWorkspace({
      ...first,
      activeEpisodeId: "ep1",
      productions: first.productions.map((production) => ({
        ...production,
        revision: production.revision + 1,
      })),
    });
    await expect(
      saveWorkspaceDocumentCas({
        ...first,
        activeEpisodeId: null,
      }),
    ).rejects.toThrow(PRODUCTION_REVISION_CONFLICT);
  });

  it("rejects asset save without revision when document exists", async () => {
    const blind = assetsFixture(projectId);
    const { saveAssetBundleDraftCas } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    await expect(saveAssetBundleDraftCas(blind)).rejects.toThrow(
      ASSET_REVISION_REQUIRED,
    );
    const before = (await loadAssetBundleDraft(projectId))!;
    const replayed = await saveAssetBundleDraft(blind);
    expect(assetBundleDocumentRevision(replayed)).toBe(
      assetBundleDocumentRevision(before),
    );
  });

  it("apply returns PREVIEW_STALE when assets renamed after preview", async () => {
    const ws = (await loadWorkspace(projectId))!;
    const assets = (await loadAssetBundleDraft(projectId))!;
    const preview = await seedPreview({
      projectId,
      userId: user.id,
      store: "management",
      workspace: ws,
      assets,
    });

    const renamed = {
      ...assets,
      characters: assets.characters.map((c) =>
        c.id === "char_1" ? { ...c, name: "江宸新" } : c,
      ),
    };
    carryAssetBundleRevision(assets, renamed);
    await saveAssetBundleDraft(renamed);

    const response = await handleInvalidRefsApply({
      projectId,
      user,
      store: "management",
      body: {
        confirm: true,
        previewId: preview.previewId,
        planDigest: preview.planDigest,
      },
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "PREVIEW_STALE",
    );

    const after = await loadWorkspace(projectId);
    expect(
      after?.productions[0]?.activeStoryboard?.scenes[0]?.shots[0]
        ?.assetMediaIds?.char_1,
    ).toBe("gen_look_a");
  });

  it("management asset change blocks workspace apply on shared production", async () => {
    const ws = (await loadWorkspace(projectId))!;
    const assets = (await loadAssetBundleDraft(projectId))!;
    // Workspace effective reads local first — seed local so workspace apply is meaningful.
    const { saveWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    await saveWorkspaceLocalAssets(attachAssetBundleRevision({ ...assets }, 0));

    const local = (await (
      await import("@/projects/workspace-sync/store")
    ).loadWorkspaceLocalAssets(projectId))!;
    const preview = await seedPreview({
      projectId,
      userId: user.id,
      store: "workspace",
      workspace: ws,
      assets: local,
    });

    // Management write bumps shared project consistency even if workspace local is unchanged.
    const renamed = {
      ...assets,
      characters: assets.characters.map((c) =>
        c.id === "char_1" ? { ...c, name: "管理端改名" } : c,
      ),
    };
    carryAssetBundleRevision(assets, renamed);
    await saveAssetBundleDraft(renamed);

    const response = await handleInvalidRefsApply({
      projectId,
      user,
      store: "workspace",
      body: {
        confirm: true,
        previewId: preview.previewId,
        planDigest: preview.planDigest,
      },
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "PREVIEW_STALE",
    );
  });

  it("concurrent asset write interleaved with apply does not commit stale repair", async () => {
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
    let applyQueued = false;

    const holder = withProjectStoryboardLock(projectId, async () => {
      while (!applyQueued) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const live = (await loadAssetBundleDraft(projectId))!;
      const renamed = {
        ...live,
        characters: live.characters.map((c) =>
          c.id === "char_1" ? { ...c, name: "并发改名" } : c,
        ),
      };
      carryAssetBundleRevision(live, renamed);
      await saveAssetBundleDraft(renamed);
      await holdGate;
    });

    await new Promise((r) => setTimeout(r, 20));
    applyQueued = true;
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
    expect(
      (await loadWorkspace(projectId))?.productions[0]?.activeStoryboard
        ?.scenes[0]?.shots[0]?.assetMediaIds?.char_1,
    ).toBe("gen_look_a");
  });

  it("updateWorkspaceUnderLock path remains CAS-safe across writers", async () => {
    const a = updateWorkspaceUnderLock(projectId, async (latest) => {
      if (!latest) return null;
      await new Promise((r) => setTimeout(r, 30));
      return {
        ...latest,
        activeEpisodeId: "ep1",
        updatedAt: new Date().toISOString(),
      };
    });
    const b = updateWorkspaceUnderLock(projectId, async (latest) => {
      if (!latest) return null;
      return {
        ...latest,
        activeEpisodeId: "ep1",
        updatedAt: new Date().toISOString(),
      };
    });
    await expect(Promise.all([a, b])).resolves.toBeTruthy();
    expect(storyboardRemoteRevision((await loadWorkspace(projectId))!)).toBeGreaterThan(
      1,
    );
  });
});
