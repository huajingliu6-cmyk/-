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
import { PERSONAL_IMAGE_NAMESPACE } from "@/personal/image-generation/constants";
import type {
  PersonalImageHistoryItem,
  PersonalImageHistoryStore,
} from "@/personal/image-generation/types";

function emptyStore(userId: string): PersonalImageHistoryStore {
  return { version: 1, userId, items: [] };
}

function localStorePath(userId: string): string {
  return resolveAppDataPath(
    PERSONAL_IMAGE_NAMESPACE,
    "users",
    `${userId}.json`,
  );
}

function normalizeItem(raw: unknown): PersonalImageHistoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const imageUrl = typeof rec.imageUrl === "string" ? rec.imageUrl.trim() : "";
  const prompt = typeof rec.prompt === "string" ? rec.prompt : "";
  const aspectRatio =
    typeof rec.aspectRatio === "string" ? rec.aspectRatio.trim() : "";
  const resolution = rec.resolution;
  const modelId = typeof rec.modelId === "string" ? rec.modelId.trim() : "";
  const count = rec.count;
  const generatedAt =
    typeof rec.generatedAt === "string" ? rec.generatedAt.trim() : "";
  if (!id || !imageUrl || !aspectRatio || !modelId || !generatedAt) return null;
  if (resolution !== "1K" && resolution !== "2K" && resolution !== "4K") {
    return null;
  }
  if (count !== 1 && count !== 2 && count !== 3) return null;
  const name =
    typeof rec.name === "string" && rec.name.trim()
      ? rec.name.trim()
      : prompt.trim().length > 40
        ? `${prompt.trim().slice(0, 40)}…`
        : prompt.trim() || "未命名";
  return {
    id,
    imageUrl,
    name,
    prompt,
    aspectRatio,
    resolution,
    modelId,
    count,
    generatedAt,
    uploadedToPersonalAssets: rec.uploadedToPersonalAssets === true,
    personalAssetId:
      typeof rec.personalAssetId === "string" && rec.personalAssetId.trim()
        ? rec.personalAssetId.trim()
        : undefined,
  };
}

function normalizeStore(
  userId: string,
  raw: unknown,
): PersonalImageHistoryStore {
  if (!raw || typeof raw !== "object") return emptyStore(userId);
  const rec = raw as Record<string, unknown>;
  const items = Array.isArray(rec.items)
    ? rec.items
        .map((item) => normalizeItem(item))
        .filter((item): item is PersonalImageHistoryItem => item != null)
    : [];
  return {
    version: 1,
    userId,
    items: items.sort(
      (a, b) =>
        Date.parse(b.generatedAt || "0") - Date.parse(a.generatedAt || "0"),
    ),
  };
}

async function readStoreLocal(userId: string): Promise<PersonalImageHistoryStore> {
  try {
    const raw = await fs.readFile(localStorePath(userId), "utf-8");
    return normalizeStore(userId, JSON.parse(raw));
  } catch {
    return emptyStore(userId);
  }
}

async function writeStoreLocal(store: PersonalImageHistoryStore): Promise<void> {
  const file = localStorePath(store.userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readStoreRemote(userId: string): Promise<{
  store: PersonalImageHistoryStore;
  revision: number;
}> {
  const doc = await getRemoteDocument<PersonalImageHistoryStore>(
    PERSONAL_IMAGE_NAMESPACE,
    userId,
  );
  if (!doc) return { store: emptyStore(userId), revision: 0 };
  return {
    store: normalizeStore(userId, doc.value),
    revision: doc.revision,
  };
}

async function writeStoreRemote(
  store: PersonalImageHistoryStore,
  expectedRevision: number,
): Promise<void> {
  await putRemoteDocument({
    namespace: PERSONAL_IMAGE_NAMESPACE,
    key: store.userId,
    expectedRevision,
    value: store,
  });
}

async function mutateStore<T>(
  userId: string,
  mutator: (store: PersonalImageHistoryStore) => {
    store: PersonalImageHistoryStore;
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
    throw new Error("个人生图历史保存冲突，请重试");
  }

  const store = await readStoreLocal(userId);
  const applied = mutator(store);
  if (!applied.skipWrite) {
    await writeStoreLocal(applied.store);
  }
  return applied.result;
}

export async function listPersonalImageHistory(
  userId: string,
): Promise<PersonalImageHistoryItem[]> {
  if (isRemoteDataOnly()) {
    const { store } = await readStoreRemote(userId);
    return store.items;
  }
  const store = await readStoreLocal(userId);
  return store.items;
}

export async function listPersonalImageHistoryPage(
  userId: string,
  input: { limit: number; offset: number },
): Promise<{
  items: PersonalImageHistoryItem[];
  total: number;
  hasMore: boolean;
}> {
  const all = await listPersonalImageHistory(userId);
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
  const offset = Math.max(0, Math.floor(input.offset));
  const items = all.slice(offset, offset + limit);
  return {
    items,
    total: all.length,
    hasMore: offset + items.length < all.length,
  };
}

export async function prependPersonalImageHistory(
  userId: string,
  items: PersonalImageHistoryItem[],
): Promise<PersonalImageHistoryItem[]> {
  if (items.length === 0) return listPersonalImageHistory(userId);
  await mutateStore(userId, (store) => ({
    store: {
      ...store,
      items: [...items, ...store.items],
    },
    result: [...items, ...store.items],
  }));
  return listPersonalImageHistory(userId);
}

export async function deletePersonalImageHistoryItem(
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

export async function markPersonalImageUploaded(
  userId: string,
  itemId: string,
  personalAssetId?: string,
): Promise<PersonalImageHistoryItem | null> {
  let updated: PersonalImageHistoryItem | null = null;
  await mutateStore(userId, (store) => {
    const items = store.items.map((item) => {
      if (item.id !== itemId) return item;
      updated = {
        ...item,
        uploadedToPersonalAssets: true,
        personalAssetId: personalAssetId ?? item.personalAssetId,
      };
      return updated;
    });
    return {
      store: { ...store, items },
      result: updated,
      skipWrite: !updated,
    };
  });
  return updated;
}

export async function updatePersonalImageHistoryName(
  userId: string,
  itemId: string,
  name: string,
): Promise<PersonalImageHistoryItem | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  let updated: PersonalImageHistoryItem | null = null;
  await mutateStore(userId, (store) => {
    const items = store.items.map((item) => {
      if (item.id !== itemId) return item;
      updated = { ...item, name: trimmed };
      return updated;
    });
    return {
      store: { ...store, items },
      result: updated,
      skipWrite: !updated,
    };
  });
  return updated;
}

export function newPersonalImageHistoryId(): string {
  return `pimg_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
