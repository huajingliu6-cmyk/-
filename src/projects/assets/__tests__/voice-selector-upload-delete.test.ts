import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { clearCharacterVoiceRefsForAudio } from "@/projects/assets/asset-audio-storage";
import type { CharacterAsset } from "@/projects/assets/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("VoiceSelector upload + hard delete contracts", () => {
  const voiceSelector = readSrc("src/projects/assets/VoiceSelector.tsx");
  const glassSelect = readSrc("src/shell/glass-select/GlassSelect.tsx");
  const glassTypes = readSrc("src/shell/glass-select/types.ts");
  const audioRoute = readSrc(
    "src/app/api/projects/[projectId]/assets-draft/audio/[assetId]/route.ts",
  );
  const characterDetail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const characterManager = readSrc("src/projects/assets/CharacterManager.tsx");
  const workspace = readSrc(
    "src/projects/assets/AssetManagementWorkspace.tsx",
  );
  const createDialog = readSrc("src/projects/assets/AudioCreateDialog.tsx");

  it("shows 上传音色 as first GlassSelect action item (not a voiceId)", () => {
    expect(glassTypes).toContain("action?: boolean");
    expect(glassTypes).toContain("removable?: boolean");
    expect(glassSelect).toContain("actionOptions");
    expect(glassSelect).toContain("onAction");
    expect(glassSelect).toContain("onRemove");
    expect(glassSelect).toContain("gs__option-remove");
    expect(voiceSelector).toContain('label: "上传音色"');
    expect(voiceSelector).toContain("UPLOAD_VOICE_ACTION_ID");
    expect(voiceSelector).toContain("actionOptions");
    expect(voiceSelector).toContain("action: true");
    expect(voiceSelector).toContain("AudioCreateDialog");
    expect(voiceSelector).toContain('fixedType="voice"');
    expect(createDialog).toContain("fixedType");
  });

  it("upload success selects new voice without auto-binding save", () => {
    expect(voiceSelector).toContain("persistThenUploadAssetAudio");
    expect(voiceSelector).toContain("onChange({");
    expect(voiceSelector).toContain("已上传项目音色，请确认后点击「绑定音色」");
    expect(voiceSelector).not.toMatch(/onSave\(/);
    expect(characterDetail).toContain("绑定音色");
    expect(characterDetail).toContain("onAudiosChange");
    expect(characterDetail).toContain("onPersistAudios");
  });

  it("project voices are removable; local voices are not", () => {
    expect(voiceSelector).toContain("toProjectOption");
    expect(voiceSelector).toContain("removable: true");
    expect(voiceSelector).toContain("toLocalOption");
    expect(voiceSelector).toMatch(
      /function toLocalOption[\s\S]*?return \{[\s\S]*?description: voice\.style,[\s\S]*?\};/,
    );
    expect(voiceSelector).not.toMatch(
      /function toLocalOption[\s\S]*?removable:\s*true/,
    );
    expect(voiceSelector).toContain("window.confirm");
    expect(voiceSelector).toContain("removingIds");
    expect(voiceSelector).toContain("hard: true");
  });

  it("wires CharacterManager + AssetManagementWorkspace audios refresh", () => {
    expect(characterManager).toContain("onAudiosChange");
    expect(characterManager).toContain("onPersistAudios");
    expect(characterManager).toContain("onVoiceHardDeleted");
    expect(characterManager).toContain("clearVoiceRefsLocally");
    expect(workspace).toContain("onAudiosChange={setAudios}");
    expect(workspace).toContain("onPersistAudios");
    expect(workspace).toContain("persist({ audios: nextAudios })");
  });

  it("audio DELETE supports hard delete that clears character voice refs", () => {
    expect(audioRoute).toContain("wantsHardDelete");
    expect(audioRoute).toContain('searchParams.get("hard") === "1"');
    expect(audioRoute).toContain("x-hard-delete");
    expect(audioRoute).toContain("hardDeleteAudioAssetRow");
    expect(audioRoute).toContain("hard: true");
    expect(audioRoute).toContain("synchronizeAssetMediaDownstream");
  });

  it("clearCharacterVoiceRefsForAudio clears primary and mediaVoices entries", () => {
    const characters: CharacterAsset[] = [
      {
        id: "char_1",
        projectId: "p1",
        name: "A",
        role: "",
        description: "",
        appearance: "",
        clothing: "",
        age: "",
        gender: "",
        voiceId: "audio_v1",
        voiceName: "V1",
        voiceStyle: "style",
        mediaVoices: {
          media_a: { voiceId: "audio_v1", voiceName: "V1" },
          media_b: { voiceId: "audio_other", voiceName: "Other" },
        },
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
      {
        id: "char_2",
        projectId: "p1",
        name: "B",
        role: "",
        description: "",
        appearance: "",
        clothing: "",
        age: "",
        gender: "",
        voiceId: "audio_other",
        voiceName: "Other",
        voiceStyle: null,
        mediaVoices: {
          media_c: { voiceId: "audio_v1", voiceName: "V1" },
        },
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ];

    const next = clearCharacterVoiceRefsForAudio(characters, "audio_v1");
    expect(next[0]?.voiceId).toBeNull();
    expect(next[0]?.voiceName).toBeNull();
    expect(next[0]?.voiceStyle).toBeNull();
    expect(next[0]?.mediaVoices).toEqual({
      media_b: { voiceId: "audio_other", voiceName: "Other" },
    });
    expect(next[1]?.voiceId).toBe("audio_other");
    expect(next[1]?.mediaVoices).toBeUndefined();
  });
});
