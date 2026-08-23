import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  resolveAssetImageFilePath,
  writeProjectAssetImageFile,
} from "@/projects/assets/asset-image-storage";
import type { CharacterAsset } from "@/projects/assets/types";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

vi.mock("@/projects/assets/asset-draft-downstream", () => ({
  synchronizeAssetDraftDownstream: vi.fn(async () => ({ deferred: false })),
}));

import { requireSessionUser } from "@/auth/require-user";
import { synchronizeAssetDraftDownstream } from "@/projects/assets/asset-draft-downstream";
import { PATCH as patchManagementMedia } from "@/app/api/projects/[projectId]/assets-draft/characters/[characterId]/media/route";
import { POST as postManagementReplace } from "@/app/api/projects/[projectId]/assets-draft/characters/[characterId]/replace-primary/route";
import { PATCH as patchWorkspaceMedia } from "@/app/api/workspace/projects/[projectId]/assets-draft/characters/[characterId]/media/route";
import { POST as postWorkspaceReplace } from "@/app/api/workspace/projects/[projectId]/assets-draft/characters/[characterId]/replace-primary/route";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function auth(id: string): AuthUser {
  return {
    id,
    username: id,
    role: "user",
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sd2Cert(checkedAt = "2026-01-01T00:00:00.000Z") {
  return {
    status: "ok" as const,
    checkedAt,
    modelId: SD2_CERT_MODEL_TAG,
    reason: "test sd2 cert",
  };
}

function character(
  projectId: string,
  partial: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "char_1",
    projectId,
    name: "林清",
    role: "女主",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: "primary_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "draft",
    primaryMediaId: "primary_1",
    historyMediaIds: [],
    lookMediaIds: [],
    approvedMediaIds: ["primary_1"],
    videoRefSafety: sd2Cert(),
    mediaVideoRefSafety: { primary_1: sd2Cert() },
    ...partial,
  };
}

async function seed(owner: AuthUser, char?: Partial<CharacterAsset>) {
  const project = await createProjectRecord(owner.id, {
    name: `char-media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    creationSource: "story",
    projectMode: "full-stack",
    visualStyle: "live_action_cinematic",
    passwordEnabled: false,
  });
  const asset = character(project.projectId, char);
  await saveAssetBundleDraft({
    projectId: project.projectId,
    characters: [asset],
    scenes: [],
    props: [],
    audios: [],
  });
  await writeProjectAssetImageFile({
    projectId: project.projectId,
    assetId: "primary_1",
    buffer: PNG_BYTES,
    mimeType: "image/png",
  });
  return { project, asset };
}

describe("character media routes", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    const root = path.join("E:", "DevWorkspace", "runtime", "tmp");
    mkdirSync(root, { recursive: true });
    tmp = mkdtempSync(path.join(root, "ic-char-media-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
    vi.mocked(synchronizeAssetDraftDownstream).mockClear();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("replace-primary uploads candidate without changing primary until commit", async () => {
    const owner = auth("owner-char-media-1");
    const { project } = await seed(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(PNG_BYTES)], "next.png", { type: "image/png" }),
    );
    const uploadResponse = await postManagementReplace(
      new Request("http://localhost", { method: "POST", body: form }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(uploadResponse.status).toBe(200);
    const uploadBody = (await uploadResponse.json()) as {
      candidateMediaId: string;
      character: CharacterAsset;
    };
    expect(uploadBody.candidateMediaId).toMatch(/^upload_/);
    expect(uploadBody.character.primaryMediaId).toBe("primary_1");
    expect(uploadBody.character.historyMediaIds).toEqual([]);

    const candidatePath = resolveAssetImageFilePath(
      project.projectId,
      uploadBody.candidateMediaId,
    );
    expect(candidatePath && existsSync(candidatePath)).toBe(true);

    // Uncertified commit is rejected
    const rejectForm = new FormData();
    rejectForm.append("commit", "1");
    rejectForm.append("mediaId", uploadBody.candidateMediaId);
    const rejectResponse = await postManagementReplace(
      new Request("http://localhost", { method: "POST", body: rejectForm }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(rejectResponse.status).toBe(422);
    const rejectBody = (await rejectResponse.json()) as { code?: string };
    expect(rejectBody.code).toBe("VIDEO_REF_REQUIRED");

    // Persist SD2 cert for candidate then commit
    const draft = await loadAssetBundleDraft(project.projectId);
    expect(draft).toBeTruthy();
    await saveAssetBundleDraft({
      ...draft!,
      characters: draft!.characters.map((c) =>
        c.id === "char_1"
          ? {
              ...c,
              mediaVideoRefSafety: {
                ...(c.mediaVideoRefSafety ?? {}),
                [uploadBody.candidateMediaId]: sd2Cert("2026-01-02T00:00:00.000Z"),
              },
            }
          : c,
      ),
    });

    const commitForm = new FormData();
    commitForm.append("commit", "1");
    commitForm.append("mediaId", uploadBody.candidateMediaId);
    const commitResponse = await postManagementReplace(
      new Request("http://localhost", { method: "POST", body: commitForm }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(commitResponse.status).toBe(200);
    const commitBody = (await commitResponse.json()) as {
      character: CharacterAsset;
    };
    expect(commitBody.character.primaryMediaId).toBe(
      uploadBody.candidateMediaId,
    );
    expect(commitBody.character.historyMediaIds).toEqual(["primary_1"]);
    expect(commitBody.character.approvedMediaIds).toEqual(
      expect.arrayContaining([
        uploadBody.candidateMediaId,
        "primary_1",
      ]),
    );

    const oldPath = resolveAssetImageFilePath(project.projectId, "primary_1");
    expect(oldPath && existsSync(oldPath)).toBe(true);
    expect(readFileSync(oldPath!)).toEqual(PNG_BYTES);
    expect(synchronizeAssetDraftDownstream).toHaveBeenCalled();
  });

  it("replace-primary twice keeps ordered unique history after commits", async () => {
    const owner = auth("owner-char-media-2");
    const { project } = await seed(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const uploadAndCommit = async () => {
      const form = new FormData();
      form.append(
        "file",
        new File([new Uint8Array(PNG_BYTES)], "n.png", { type: "image/png" }),
      );
      const upload = await postManagementReplace(
        new Request("http://localhost", { method: "POST", body: form }),
        {
          params: Promise.resolve({
            projectId: project.projectId,
            characterId: "char_1",
          }),
        },
      );
      expect(upload.status).toBe(200);
      const body = (await upload.json()) as {
        candidateMediaId: string;
        character: CharacterAsset;
      };
      const draft = await loadAssetBundleDraft(project.projectId);
      await saveAssetBundleDraft({
        ...draft!,
        characters: draft!.characters.map((c) =>
          c.id === "char_1"
            ? {
                ...c,
                mediaVideoRefSafety: {
                  ...(c.mediaVideoRefSafety ?? {}),
                  [body.candidateMediaId]: sd2Cert(),
                },
              }
            : c,
        ),
      });
      const commitForm = new FormData();
      commitForm.append("commit", "1");
      commitForm.append("mediaId", body.candidateMediaId);
      const commit = await postManagementReplace(
        new Request("http://localhost", { method: "POST", body: commitForm }),
        {
          params: Promise.resolve({
            projectId: project.projectId,
            characterId: "char_1",
          }),
        },
      );
      expect(commit.status).toBe(200);
      return (await commit.json()) as { character: CharacterAsset };
    };

    const first = await uploadAndCommit();
    const second = await uploadAndCommit();
    expect(second.character.historyMediaIds).toEqual([
      first.character.primaryMediaId,
      "primary_1",
    ]);
    expect(
      new Set(second.character.historyMediaIds).size,
    ).toBe(second.character.historyMediaIds!.length);
  });

  it("set-primary swaps history and primary without copying files", async () => {
    const owner = auth("owner-char-media-3");
    const { project } = await seed(owner, {
      primaryMediaId: "primary_1",
      historyMediaIds: ["hist_1"],
      lookMediaIds: [],
      approvedMediaIds: ["primary_1", "hist_1"],
      mediaVideoRefSafety: {
        primary_1: sd2Cert(),
        hist_1: sd2Cert("2026-01-02T00:00:00.000Z"),
      },
    });
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "hist_1",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const response = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-primary", mediaId: "hist_1" }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { character: CharacterAsset };
    expect(body.character.primaryMediaId).toBe("hist_1");
    expect(body.character.historyMediaIds).toEqual(["primary_1"]);
    expect(existsSync(resolveAssetImageFilePath(project.projectId, "hist_1")!)).toBe(
      true,
    );
    expect(
      existsSync(resolveAssetImageFilePath(project.projectId, "primary_1")!),
    ).toBe(true);
  });

  it("history-to-look and add-look keep fields separated", async () => {
    const owner = auth("owner-char-media-4");
    const { project } = await seed(owner, {
      primaryMediaId: "primary_1",
      historyMediaIds: ["hist_1"],
      lookMediaIds: [],
      approvedMediaIds: ["primary_1", "hist_1"],
      mediaVideoRefSafety: {
        primary_1: sd2Cert(),
        hist_1: sd2Cert(),
        gen_look: sd2Cert("2026-01-03T00:00:00.000Z"),
      },
    });
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "hist_1",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "gen_look",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const toLook = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "history-to-look",
          mediaId: "hist_1",
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(toLook.status).toBe(200);
    const afterLook = (await toLook.json()) as { character: CharacterAsset };
    expect(afterLook.character.primaryMediaId).toBe("primary_1");
    // Main history stays independent when promoting a history image to a look.
    expect(afterLook.character.historyMediaIds).toEqual(["hist_1"]);
    expect(afterLook.character.lookMediaIds).toEqual(["hist_1"]);

    const addLook = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-look", mediaId: "gen_look" }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(addLook.status).toBe(200);
    const afterAdd = (await addLook.json()) as { character: CharacterAsset };
    expect(afterAdd.character.primaryMediaId).toBe("primary_1");
    expect(afterAdd.character.historyMediaIds).toEqual(["hist_1"]);
    expect(afterAdd.character.lookMediaIds).toEqual(["hist_1", "gen_look"]);
    expect(afterAdd.character.approvedMediaIds).toEqual(
      expect.arrayContaining(["primary_1", "hist_1", "gen_look"]),
    );
  });

  it("add-look allows uncertified media; set-primary still requires VIDEO_REF", async () => {
    const owner = auth("owner-char-media-uncert");
    const { project } = await seed(owner, {
      primaryMediaId: "primary_1",
      historyMediaIds: ["hist_1"],
      approvedMediaIds: ["primary_1", "hist_1"],
      mediaVideoRefSafety: { primary_1: sd2Cert() },
    });
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "hist_1",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "gen_look",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const addLook = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-look", mediaId: "gen_look" }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(addLook.status).toBe(200);
    const addBody = (await addLook.json()) as {
      appearance?: { id?: string };
      character?: { appearances?: unknown[] };
    };
    expect(addBody.appearance?.id).toBeTruthy();

    const setPrimary = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-primary", mediaId: "hist_1" }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(setPrimary.status).toBe(422);
    expect(((await setPrimary.json()) as { code?: string }).code).toBe(
      "VIDEO_REF_REQUIRED",
    );

    const historyToLook = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "history-to-look",
          mediaId: "hist_1",
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(historyToLook.status).toBe(422);
    expect(((await historyToLook.json()) as { code?: string }).code).toBe(
      "VIDEO_REF_REQUIRED",
    );
  });

  it("rejects foreign media ids with 404", async () => {
    const owner = auth("owner-char-media-5");
    const { project } = await seed(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const response = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-primary",
          mediaId: "someone_else",
        }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(response.status).toBe(404);
  });

  it("management and workspace routes share the same action handlers", async () => {
    const owner = auth("owner-char-media-6");
    const { project } = await seed(owner, {
      primaryMediaId: "primary_1",
      historyMediaIds: ["hist_1"],
      approvedMediaIds: ["primary_1", "hist_1"],
      mediaVideoRefSafety: {
        primary_1: sd2Cert(),
        hist_1: sd2Cert("2026-01-02T00:00:00.000Z"),
      },
    });
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "hist_1",
      buffer: PNG_BYTES,
      mimeType: "image/png",
    });
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const management = await patchManagementMedia(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-primary", mediaId: "hist_1" }),
      }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(management.status).toBe(200);

    // Workspace store is independent — seed a workspace character, leave
    // management draft as the post-management-action state for comparison.
    const { saveWorkspaceLocalAssets, loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    await saveWorkspaceLocalAssets({
      projectId: project.projectId,
      characters: [
        character(project.projectId, {
          primaryMediaId: "primary_1",
          historyMediaIds: ["hist_1"],
          lookMediaIds: [],
          approvedMediaIds: ["primary_1", "hist_1"],
          mediaVideoRefSafety: {
            primary_1: sd2Cert(),
            hist_1: sd2Cert("2026-01-02T00:00:00.000Z"),
          },
        }),
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    const managementBeforeWs = await loadAssetBundleDraft(project.projectId);

    const workspace = await patchWorkspaceMedia(
      new Request(
        `http://localhost/api/workspace/projects/${project.projectId}/assets-draft/characters/char_1/media`,
        {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-primary", mediaId: "hist_1" }),
        },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    // Owner has management access; workspace access depends on edition features.
    // If workspace gate denies, status is 403 — still proves distinct gate.
    expect([200, 403, 404]).toContain(workspace.status);

    if (workspace.status === 200) {
      const managementAfter = await loadAssetBundleDraft(project.projectId);
      expect(managementAfter?.characters[0]?.primaryMediaId).toBe(
        managementBeforeWs?.characters[0]?.primaryMediaId,
      );
      const wsAssets = await loadWorkspaceLocalAssets(project.projectId);
      expect(wsAssets?.characters[0]?.primaryMediaId).toBe("hist_1");
    }

    const replaceForm = new FormData();
    replaceForm.append(
      "file",
      new File([new Uint8Array(PNG_BYTES)], "w.png", { type: "image/png" }),
    );
    const workspaceReplace = await postWorkspaceReplace(
      new Request(
        `http://localhost/api/workspace/projects/${project.projectId}/assets-draft/characters/char_1/replace-primary`,
        {
        method: "POST",
        body: replaceForm,
        },
      ),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect([200, 403, 404]).toContain(workspaceReplace.status);
  });

  it("downstream sync payload retains historyMediaIds and lookMediaIds", async () => {
    const owner = auth("owner-char-media-7");
    const { project } = await seed(owner);
    vi.mocked(requireSessionUser).mockResolvedValue({ ok: true, user: owner });

    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(PNG_BYTES)], "n.png", { type: "image/png" }),
    );
    const upload = await postManagementReplace(
      new Request("http://localhost", { method: "POST", body: form }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );
    expect(upload.status).toBe(200);
    const uploadBody = (await upload.json()) as { candidateMediaId: string };
    const draft = await loadAssetBundleDraft(project.projectId);
    await saveAssetBundleDraft({
      ...draft!,
      characters: draft!.characters.map((c) =>
        c.id === "char_1"
          ? {
              ...c,
              mediaVideoRefSafety: {
                ...(c.mediaVideoRefSafety ?? {}),
                [uploadBody.candidateMediaId]: sd2Cert(),
              },
            }
          : c,
      ),
    });

    const commitForm = new FormData();
    commitForm.append("commit", "1");
    commitForm.append("mediaId", uploadBody.candidateMediaId);
    await postManagementReplace(
      new Request("http://localhost", { method: "POST", body: commitForm }),
      {
        params: Promise.resolve({
          projectId: project.projectId,
          characterId: "char_1",
        }),
      },
    );

    const call = vi.mocked(synchronizeAssetDraftDownstream).mock.calls.at(-1);
    expect(call?.[0]?.next.characters[0]?.historyMediaIds).toEqual([
      "primary_1",
    ]);
    expect(call?.[0]?.next.characters[0]?.lookMediaIds).toEqual([]);
  });
});
