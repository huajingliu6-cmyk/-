/** Simple per-project async mutex for approval mutations. */

const chains = new Map<string, Promise<unknown>>();

export async function withProjectApprovalLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate);
  chains.set(projectId, next);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(projectId) === next) {
      chains.delete(projectId);
    }
  }
}
