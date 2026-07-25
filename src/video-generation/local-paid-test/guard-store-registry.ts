import type { WanLocalPaidTestGuardStore } from "./guard-store";
import { FileWanLocalPaidTestGuardStore } from "./guard-store";

type GuardStoreGlobal = typeof globalThis & {
  __infiniteCanvasLocalPaidTestGuardStore?: WanLocalPaidTestGuardStore;
};

function StoreGlobal(): GuardStoreGlobal {
  return globalThis as GuardStoreGlobal;
}

/** Live Guard store（可测试注入临时目录） */
export function getLocalPaidTestGuardStore(): WanLocalPaidTestGuardStore {
  const g = StoreGlobal();
  if (!g.__infiniteCanvasLocalPaidTestGuardStore) {
    g.__infiniteCanvasLocalPaidTestGuardStore =
      new FileWanLocalPaidTestGuardStore({ namespace: "live" });
  }
  return g.__infiniteCanvasLocalPaidTestGuardStore;
}

export function setLocalPaidTestGuardStoreForTests(
  store: WanLocalPaidTestGuardStore | null,
): void {
  const g = StoreGlobal();
  if (store === null) {
    delete g.__infiniteCanvasLocalPaidTestGuardStore;
  } else {
    g.__infiniteCanvasLocalPaidTestGuardStore = store;
  }
}
