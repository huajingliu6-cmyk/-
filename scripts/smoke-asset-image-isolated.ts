/**
 * Isolated smoke for project asset image disk + shared draft metadata.
 * Never touches repository data/. Complements route unit tests; not Playwright UI.
 */
import { existsSync, readFileSync } from "fs";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";
import { createUser } from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "../src/projects/assets/asset-bundle-store";
import {
  patchImageableAssetImageMeta,
  resolveAssetImageFilePath,
  writeProjectAssetImageFile,
} from "../src/projects/assets/asset-image-storage";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

async function main() {
  const session = beginIsolatedSmokeAppDataSession();
  const results: Array<{ name: string; ok: boolean }> = [];
  try {
    const owner = await createUser({
      username: `smoke_img_owner_${Date.now()}`,
      password: "Smoke@123456",
      displayName: "Owner",
    });
    const engineer = await createUser({
      username: `smoke_img_eng_${Date.now()}`,
      password: "Smoke@123456",
      displayName: "Engineer",
    });
    const project = await createProjectRecord(owner.id, {
      name: `Smoke Asset Image ${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });
    const other = await createProjectRecord(owner.id, {
      name: `Smoke Asset Other ${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });

    await saveAssetBundleDraft({
      projectId: project.projectId,
      characters: [
        {
          id: "char_smoke",
          projectId: project.projectId,
          name: "SmokeChar",
          role: "lead",
          description: "d",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });

    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "char_smoke",
      buffer: PNG,
      mimeType: "image/png",
    });
    await patchImageableAssetImageMeta({
      projectId: project.projectId,
      assetId: "char_smoke",
      imageFileName: "smoke.png",
      imageMimeType: "image/png",
    });

    const disk = resolveAssetImageFilePath(project.projectId, "char_smoke");
    results.push({
      name: "management-upload-disk",
      ok: !!disk && existsSync(disk) && readFileSync(disk).equals(PNG),
    });

    let draft = await loadAssetBundleDraft(project.projectId);
    results.push({
      name: "refresh-metadata",
      ok:
        draft?.characters[0]?.imageFileName === "smoke.png" &&
        draft.characters[0].imageObjectUrl === null,
    });

    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: "char_smoke",
      buffer: JPEG,
      mimeType: "image/jpeg",
    });
    await patchImageableAssetImageMeta({
      projectId: project.projectId,
      assetId: "char_smoke",
      imageFileName: "smoke.jpg",
      imageMimeType: "image/jpeg",
    });
    results.push({
      name: "replace-image",
      ok: !!disk && readFileSync(disk).equals(JPEG),
    });

    draft = await loadAssetBundleDraft(project.projectId);
    results.push({
      name: "workspace-same-bundle",
      ok: draft?.characters[0]?.imageFileName === "smoke.jpg",
    });

    const cross = resolveAssetImageFilePath(other.projectId, "char_smoke");
    results.push({
      name: "cross-project-no-file",
      ok: !cross || !existsSync(cross),
    });

    const failed = results.filter((r) => !r.ok);
    console.log(
      JSON.stringify(
        {
          ok: failed.length === 0,
          appDataDir: session.appDataDir,
          results,
          note: "Browser UI smoke not automated (no Playwright gate). Route permission matrix covered by asset-image-routes.test.ts.",
        },
        null,
        2,
      ),
    );
    if (failed.length) process.exitCode = 1;
  } finally {
    session.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
