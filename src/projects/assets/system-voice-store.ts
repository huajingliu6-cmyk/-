import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  getRemoteDocument,
  isRemoteDataOnly,
  putRemoteDocument,
} from "@/persistence/remote-data-client";
import { SYSTEM_VOICE_CATALOG } from "@/projects/assets/system-voice-catalog";
import {
  systemVoiceToOption,
  type SystemVoiceRecord,
  type SystemVoiceStatus,
} from "@/projects/assets/system-voice-types";

export type { SystemVoiceRecord, SystemVoiceStatus };
export { systemVoiceToOption };

type SystemVoiceCatalog = {
  version: 1;
  voices: SystemVoiceRecord[];
};

const NAMESPACE = "system-voices";
const CATALOG_KEY = "catalog";

function nowIso(): string {
  return new Date().toISOString();
}

function localCatalogPath(): string {
  return resolveAppDataPath("system-voices", "catalog.json");
}

function emptyCatalog(): SystemVoiceCatalog {
  return { version: 1, voices: [] };
}

function seedFromMockCatalog(): SystemVoiceCatalog {
  const now = nowIso();
  return {
    version: 1,
    voices: SYSTEM_VOICE_CATALOG.map((voice, index) => ({
      id: voice.id,
      name: voice.name,
      label: voice.label || voice.name,
      style: voice.style || "",
      gender: voice.gender ?? "neutral",
      ageRange: voice.ageRange || "",
      language: voice.language || "中文",
      emotion: voice.emotion || "",
      tone: voice.tone || "",
      description: voice.description || "",
      mediaId: null,
      storageKey: null,
      previewUrl: `/api/voices/${encodeURIComponent(voice.id)}/preview`,
      source: "system" as const,
      status: "active" as const,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
      createdBy: "system-seed",
    })),
  };
}

function normalizeGender(
  value: unknown,
): "male" | "female" | "neutral" {
  if (value === "male" || value === "female" || value === "neutral") {
    return value;
  }
  return "neutral";
}

function normalizeVoice(raw: unknown): SystemVoiceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const name = typeof rec.name === "string" ? rec.name.trim() : "";
  if (!id || !name) return null;
  const mediaId =
    typeof rec.mediaId === "string" && rec.mediaId.trim()
      ? rec.mediaId.trim()
      : null;
  return {
    id,
    name,
    label:
      typeof rec.label === "string" && rec.label.trim()
        ? rec.label.trim()
        : name,
    style: typeof rec.style === "string" ? rec.style.trim() : "",
    gender: normalizeGender(rec.gender),
    ageRange: typeof rec.ageRange === "string" ? rec.ageRange.trim() : "",
    language: typeof rec.language === "string" ? rec.language.trim() : "中文",
    emotion: typeof rec.emotion === "string" ? rec.emotion.trim() : "",
    tone: typeof rec.tone === "string" ? rec.tone.trim() : "",
    description:
      typeof rec.description === "string" ? rec.description.trim() : "",
    mediaId,
    storageKey:
      typeof rec.storageKey === "string" && rec.storageKey.trim()
        ? rec.storageKey.trim()
        : mediaId
          ? `system-voices/${mediaId}`
          : null,
    previewUrl: `/api/voices/${encodeURIComponent(id)}/preview`,
    source: "system",
    status: rec.status === "deleted" ? "deleted" : "active",
    sortOrder:
      typeof rec.sortOrder === "number" && Number.isFinite(rec.sortOrder)
        ? rec.sortOrder
        : 0,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : nowIso(),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : nowIso(),
    createdBy: typeof rec.createdBy === "string" ? rec.createdBy : "",
  };
}

async function readCatalog(): Promise<SystemVoiceCatalog> {
  if (isRemoteDataOnly()) {
    const doc = await getRemoteDocument<SystemVoiceCatalog>(
      NAMESPACE,
      CATALOG_KEY,
    );
    if (!doc?.value) return seedFromMockCatalog();
    const voices = Array.isArray(doc.value.voices)
      ? doc.value.voices.map(normalizeVoice).filter(Boolean)
      : [];
    if (voices.length === 0) return seedFromMockCatalog();
    return { version: 1, voices: voices as SystemVoiceRecord[] };
  }

  try {
    const raw = await fs.readFile(localCatalogPath(), "utf-8");
    const parsed = JSON.parse(raw) as SystemVoiceCatalog;
    const voices = Array.isArray(parsed.voices)
      ? parsed.voices.map(normalizeVoice).filter(Boolean)
      : [];
    if (voices.length === 0) {
      const seeded = seedFromMockCatalog();
      await writeCatalog(seeded);
      return seeded;
    }
    return { version: 1, voices: voices as SystemVoiceRecord[] };
  } catch {
    const seeded = seedFromMockCatalog();
    await writeCatalog(seeded);
    return seeded;
  }
}

async function writeCatalog(catalog: SystemVoiceCatalog): Promise<void> {
  const payload: SystemVoiceCatalog = {
    version: 1,
    voices: catalog.voices,
  };
  if (isRemoteDataOnly()) {
    await putRemoteDocument({
      namespace: NAMESPACE,
      key: CATALOG_KEY,
      value: payload,
    });
    return;
  }
  const file = localCatalogPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

export async function listSystemVoices(input?: {
  includeDeleted?: boolean;
}): Promise<SystemVoiceRecord[]> {
  const catalog = await readCatalog();
  const voices = catalog.voices
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  if (input?.includeDeleted) return voices;
  return voices.filter((voice) => voice.status === "active");
}

export async function getSystemVoiceById(
  voiceId: string,
): Promise<SystemVoiceRecord | null> {
  const id = voiceId.trim();
  if (!id) return null;
  const catalog = await readCatalog();
  return catalog.voices.find((voice) => voice.id === id) ?? null;
}

export async function createSystemVoice(input: {
  name: string;
  label?: string;
  style?: string;
  gender?: "male" | "female" | "neutral";
  ageRange?: string;
  language?: string;
  emotion?: string;
  tone?: string;
  description?: string;
  mediaId: string;
  createdBy: string;
}): Promise<SystemVoiceRecord> {
  const name = input.name.trim();
  if (!name) throw new Error("音色名称不能为空");
  const mediaId = input.mediaId.trim();
  if (!mediaId) throw new Error("缺少音频 mediaId");

  const catalog = await readCatalog();
  const now = nowIso();
  const id = `sys_voice_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const maxOrder = catalog.voices.reduce(
    (max, voice) => Math.max(max, voice.sortOrder),
    -1,
  );
  const voice: SystemVoiceRecord = {
    id,
    name,
    label: input.label?.trim() || name,
    style: input.style?.trim() || "",
    gender: input.gender ?? "neutral",
    ageRange: input.ageRange?.trim() || "",
    language: input.language?.trim() || "中文",
    emotion: input.emotion?.trim() || "",
    tone: input.tone?.trim() || "",
    description: input.description?.trim() || "",
    mediaId,
    storageKey: `system-voices/${mediaId}`,
    previewUrl: `/api/voices/${encodeURIComponent(id)}/preview`,
    source: "system",
    status: "active",
    sortOrder: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };
  catalog.voices.push(voice);
  await writeCatalog(catalog);
  return voice;
}

export async function updateSystemVoice(
  voiceId: string,
  patch: Partial<{
    name: string;
    label: string;
    style: string;
    gender: "male" | "female" | "neutral";
    ageRange: string;
    language: string;
    emotion: string;
    tone: string;
    description: string;
    sortOrder: number;
    status: SystemVoiceStatus;
    mediaId: string;
  }>,
): Promise<SystemVoiceRecord> {
  const catalog = await readCatalog();
  const index = catalog.voices.findIndex((voice) => voice.id === voiceId);
  if (index < 0) throw new Error("音色不存在");
  const current = catalog.voices[index]!;
  const next: SystemVoiceRecord = {
    ...current,
    name: patch.name?.trim() || current.name,
    label: patch.label?.trim() || current.label,
    style: patch.style !== undefined ? patch.style.trim() : current.style,
    gender: patch.gender ?? current.gender,
    ageRange:
      patch.ageRange !== undefined ? patch.ageRange.trim() : current.ageRange,
    language:
      patch.language !== undefined ? patch.language.trim() : current.language,
    emotion:
      patch.emotion !== undefined ? patch.emotion.trim() : current.emotion,
    tone: patch.tone !== undefined ? patch.tone.trim() : current.tone,
    description:
      patch.description !== undefined
        ? patch.description.trim()
        : current.description,
    sortOrder:
      typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)
        ? patch.sortOrder
        : current.sortOrder,
    status: patch.status ?? current.status,
    mediaId: patch.mediaId?.trim() || current.mediaId,
    storageKey: patch.mediaId?.trim()
      ? `system-voices/${patch.mediaId.trim()}`
      : current.storageKey,
    updatedAt: nowIso(),
  };
  catalog.voices[index] = next;
  await writeCatalog(catalog);
  return next;
}

export async function softDeleteSystemVoice(
  voiceId: string,
): Promise<SystemVoiceRecord> {
  return updateSystemVoice(voiceId, { status: "deleted" });
}

export async function restoreSystemVoice(
  voiceId: string,
): Promise<SystemVoiceRecord> {
  return updateSystemVoice(voiceId, { status: "active" });
}

/** @deprecated Prefer getSystemVoiceById + store; kept for id checks. */
export function isSystemVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === "string" && voiceId.startsWith("sys_voice_");
}
