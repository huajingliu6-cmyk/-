import type { GenerationIdempotencyStore } from "./types";
import { FileGenerationIdempotencyStore } from "./file-store";

export {
  IDEMPOTENCY_RECORD_TTL_MS,
  IDEMPOTENCY_SCOPE,
  SUBMITTING_STALE_MS,
} from "./constants";

type StoreGlobal = typeof globalThis & {
  __infiniteCanvasIdempotencyStore?: GenerationIdempotencyStore;
};

export function getIdempotencyStore(): GenerationIdempotencyStore {
  const g = StoreGlobal();
  if (!g.__infiniteCanvasIdempotencyStore) {
    g.__infiniteCanvasIdempotencyStore = new FileGenerationIdempotencyStore();
  }
  return g.__infiniteCanvasIdempotencyStore;
}

function StoreGlobal(): StoreGlobal {
  return globalThis as StoreGlobal;
}

/** 测试可注入内存/临时目录 store；传 null 恢复默认文件 store */
export function setIdempotencyStoreForTests(
  store: GenerationIdempotencyStore | null,
): void {
  const g = StoreGlobal();
  if (store === null) {
    delete g.__infiniteCanvasIdempotencyStore;
  } else {
    g.__infiniteCanvasIdempotencyStore = store;
  }
}

export async function clearIdempotencyStoreForTests(): Promise<void> {
  const store = getIdempotencyStore();
  if (store instanceof FileGenerationIdempotencyStore) {
    await store.clearAllForTests();
  }
}
