import "server-only";

import { randomUUID } from "crypto";

type WorkerGlobal = typeof globalThis & {
  __infiniteCanvasImageWorkerInstanceId?: string;
};

/**
 * Stable for the lifetime of this Node process.
 * New process boot → new id; used to detect stale image jobs after restart.
 */
export function getImageWorkerInstanceId(): string {
  const g = globalThis as WorkerGlobal;
  if (!g.__infiniteCanvasImageWorkerInstanceId) {
    g.__infiniteCanvasImageWorkerInstanceId = `wkr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
  return g.__infiniteCanvasImageWorkerInstanceId;
}

/** Test-only: force a known worker id. */
export function setImageWorkerInstanceIdForTests(id: string): void {
  (globalThis as WorkerGlobal).__infiniteCanvasImageWorkerInstanceId = id;
}
