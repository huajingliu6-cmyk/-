import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  getRemoteDocument,
  isRemoteDataOnly,
  putRemoteDocument,
} from "@/persistence/remote-data-client";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  PERSONAL_VIDEO_HISTORY_LIMITS,
  PERSONAL_VIDEO_NAMESPACE,
  PERSONAL_VIDEO_RESOLUTION,
} from "@/personal/video-generation/constants";
import { repairLegacyPersonalVideoUrl } from "@/personal/video-generation/content-url";
import { normalizePersonalVideoPosterUrl } from "@/personal/video-generation/poster-url";
import { parseStoryboardVideoStylePreset } from "@/projects/storyboard/storyboard-video-model-choices";
import { parseStoryboardVideoResolution } from "@/projects/storyboard/storyboard-video-params";
import type {
  PersonalVideoHistoryItem,
  PersonalVideoHistoryStore,
} from "@/personal/video-generation/types";

function emptyStore(userId: string): PersonalVideoHistoryStore {
  return { version: 1, userId, items: [] };
}

function localStorePath(userId: string): string {
  return resolveAppDataPath(
    PERSONAL_VIDEO_NAMESPACE,
    "users",
    `${userId}.json`,
  );
}

function normalizeItem(raw: unknown): PersonalVideoHistoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const generationId =
    typeof rec.generationId === "string" ? rec.generationId.trim() : "";
  const prompt = typeof rec.prompt === "string" ? rec.prompt : "";
  const aspectRatio = rec.aspectRatio;
  const durationSeconds = Number(rec.durationSeconds);
  const modelId = typeof rec.modelId === "string" ? rec.modelId.trim() : "";
  const status = typeof rec.status === "string" ? rec.status.trim() : "";
  const generatedAt =
    typeof rec.generatedAt === "string" ? rec.generatedAt.trim() : "";
  if (!id || !generationId || !modelId || !generatedAt) return null;
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16") return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return {
    id,
    generationId,
    prompt,
    aspectRatio,
    durationSeconds,
    modelId,
    resolution:
      parseStoryboardVideoResolution(rec.resolution) ?? PERSONAL_VIDEO_RESOLUTION,
    stylePreset: parseStoryboardVideoStylePreset(rec.stylePreset) || undefined,
    status: status as PersonalVideoHistoryItem["status"],
    videoUrl:
      typeof rec.videoUrl === "string" && rec.videoUrl.trim()
        ? rec.videoUrl.trim()
        : null,
    posterUrl:
      typeof rec.posterUrl === "string" && rec.posterUrl.trim()
        ? rec.posterUrl.trim()
        : null,
    generatedAt,
    errorMessage:
      typeof rec.errorMessage === "string" ? rec.errorMessage : undefined,
  };
}

function trimHistoryByAspectRatio(
  items: PersonalVideoHistoryItem[],
): PersonalVideoHistoryItem[] {
  const landscape: PersonalVideoHistoryItem[] = [];
  const portrait: PersonalVideoHistoryItem[] = [];
  for (const item of items) {
    if (item.aspectRatio === "16:9") landscape.push(item);
    else portrait.push(item);
  }
  return [
    ...landscape.slice(0, PERSONAL_VIDEO_HISTORY_LIMITS["16:9"]),
    ...portrait.slice(0, PERSONAL_VIDEO_HISTORY_LIMITS["9:16"]),
  ].sort(
    (a, b) =>
      Date.parse(b.generatedAt || "0") - Date.parse(a.generatedAt || "0"),
  );
}

function normalizeStore(
  userId: string,
  raw: unknown,
): PersonalVideoHistoryStore {
  if (!raw || typeof raw !== "object") return emptyStore(userId);
  const rec = raw as Record<string, unknown>;
  const items = Array.isArray(rec.items)
    ? rec.items
        .map((item) => normalizeItem(item))
        .filter((item): item is PersonalVideoHistoryItem => item != null)
    : [];
  return {
    version: 1,
    userId,
    items: trimHistoryByAspectRatio(
      items.sort(
        (a, b) =>
          Date.parse(b.generatedAt || "0") - Date.parse(a.generatedAt || "0"),
      ),
    ),
  };
}

async function readStoreLocal(userId: string): Promise<PersonalVideoHistoryStore> {
  try {
    const raw = await fs.readFile(localStorePath(userId), "utf-8");
    return normalizeStore(userId, JSON.parse(raw));
  } catch {
    return emptyStore(userId);
  }
}

async function writeStoreLocal(store: PersonalVideoHistoryStore): Promise<void> {
  const file = localStorePath(store.userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readStoreRemote(userId: string): Promise<{
  store: PersonalVideoHistoryStore;
  revision: number;
}> {
  const doc = await getRemoteDocument<PersonalVideoHistoryStore>(
    PERSONAL_VIDEO_NAMESPACE,
    userId,
  );
  if (!doc) return { store: emptyStore(userId), revision: 0 };
  return {
    store: normalizeStore(userId, doc.value),
    revision: doc.revision,
  };
}

async function writeStoreRemote(
  store: PersonalVideoHistoryStore,
  expectedRevision: number,
): Promise<void> {
  await putRemoteDocument({
    namespace: PERSONAL_VIDEO_NAMESPACE,
    key: store.userId,
    expectedRevision,
    value: store,
  });
}

async function mutateStore<T>(
  userId: string,
  mutator: (store: PersonalVideoHistoryStore) => {
    store: PersonalVideoHistoryStore;
    result: T;
    skipWrite?: boolean;
  },
): Promise<T> {
  if (isRemoteDataOnly()) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { store, revision } = await readStoreRemote(userId);
      const applied = mutator(store);
      if (applied.skipWrite) return applied.result;
      try {
        await writeStoreRemote(applied.store, revision);
        return applied.result;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "REVISION_CONFLICT" &&
          attempt < 4
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("个人视频历史保存冲突，请重试");
  }

  const store = await readStoreLocal(userId);
  const applied = mutator(store);
  if (!applied.skipWrite) {
    await writeStoreLocal(applied.store);
  }
  return applied.result;
}

function withRepairedVideoUrls(
  userId: string,
  items: PersonalVideoHistoryItem[],
): PersonalVideoHistoryItem[] {
  return items.map((item) => {
    const videoUrl = repairLegacyPersonalVideoUrl(item, userId);
    const posterUrl = normalizePersonalVideoPosterUrl(item.posterUrl, videoUrl);
    if (videoUrl === item.videoUrl && posterUrl === item.posterUrl) return item;
    return { ...item, videoUrl, posterUrl };
  });
}

export async function listPersonalVideoHistory(
  userId: string,
): Promise<PersonalVideoHistoryItem[]> {
  if (isRemoteDataOnly()) {
    const { store } = await readStoreRemote(userId);
    return withRepairedVideoUrls(userId, store.items);
  }
  const store = await readStoreLocal(userId);
  return withRepairedVideoUrls(userId, store.items);
}

export async function prependPersonalVideoHistory(
  userId: string,
  item: PersonalVideoHistoryItem,
): Promise<PersonalVideoHistoryItem[]> {
  await mutateStore(userId, (store) => {
    const items = trimHistoryByAspectRatio([item, ...store.items]);
    return {
      store: { ...store, items },
      result: items,
    };
  });
  return listPersonalVideoHistory(userId);
}

export async function upsertPersonalVideoHistoryItem(
  userId: string,
  item: PersonalVideoHistoryItem,
): Promise<PersonalVideoHistoryItem | null> {
  let updated: PersonalVideoHistoryItem | null = null;
  await mutateStore(userId, (store) => {
    const items = trimHistoryByAspectRatio(
      store.items.map((entry) => {
        if (entry.id !== item.id) return entry;
        updated = item;
        return item;
      }),
    );
    return {
      store: { ...store, items },
      result: updated,
      skipWrite: !updated,
    };
  });
  return updated;
}

export async function deletePersonalVideoHistoryItem(
  userId: string,
  itemId: string,
): Promise<boolean> {
  let deleted = false;
  await mutateStore(userId, (store) => {
    const next = store.items.filter((item) => item.id !== itemId);
    deleted = next.length !== store.items.length;
    return {
      store: { ...store, items: next },
      result: deleted,
      skipWrite: !deleted,
    };
  });
  return deleted;
}

export function findPersonalVideoHistoryItem(
  userId: string,
  items: PersonalVideoHistoryItem[],
  itemId: string,
): PersonalVideoHistoryItem | null {
  return items.find((item) => item.id === itemId || item.generationId === itemId) ?? null;
}

export function newPersonalVideoHistoryId(): string {
  return `pvid_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function personalVideoProjectId(userId: string): string {
  return `personal-${userId}`;
}
