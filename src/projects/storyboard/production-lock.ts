/**
 * Per-project async mutex for storyboard production document mutations.
 * Shared by management + workspace invalid-refs apply and all saveWorkspace paths.
 * Re-entrant for the same projectId within an already-held critical section.
 */

import { AsyncLocalStorage } from "async_hooks";

const chains = new Map<string, Promise<unknown>>();
const heldProject = new AsyncLocalStorage<string>();

export async function withProjectStoryboardLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = projectId.trim();
  if (!id) {
    throw new Error("projectId required for storyboard lock");
  }

  if (heldProject.getStore() === id) {
    return fn();
  }

  const prev = chains.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate);
  chains.set(id, next);
  await prev.catch(() => undefined);

  try {
    return await heldProject.run(id, fn);
  } finally {
    release();
    if (chains.get(id) === next) {
      chains.delete(id);
    }
  }
}

/** Test helper: whether the current async context holds the project lock. */
export function isProjectStoryboardLockHeld(projectId: string): boolean {
  return heldProject.getStore() === projectId.trim();
}
