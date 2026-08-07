"use client";

/**
 * Memory-only GET request coalescing for identical URLs within the page lifetime.
 * Never writes to localStorage / sessionStorage / IndexedDB.
 *
 * Caller AbortSignals cancel only that waiter's interest — they must not abort the
 * shared underlying fetch (React Strict Mode remounts would otherwise leave
 * AuthenticatedNavigation stuck on the workspace-only fallback).
 */
const inflight = new Map<string, Promise<Response>>();

export type MemoryFetchInit = RequestInit & {
  /** When true, bypass coalescing (default false for GET). */
  dedupe?: boolean;
};

function abortedError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function withCallerSignal(
  shared: Promise<Response>,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) return Promise.reject(abortedError());

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(abortedError());
          return;
        }
        resolve(response);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function memoryFetch(
  input: string,
  init: MemoryFetchInit = {},
): Promise<Response> {
  const { signal, dedupe, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const shouldDedupe = dedupe !== false && method === "GET" && !rest.body;
  const key = shouldDedupe ? `${method}:${input}` : null;

  if (signal?.aborted) {
    return Promise.reject(abortedError());
  }

  let shared: Promise<Response>;
  if (key) {
    const existing = inflight.get(key);
    if (existing) {
      shared = existing.then((response) => response.clone());
    } else {
      // Intentionally omit caller `signal` from the shared fetch.
      const request = fetch(input, {
        ...rest,
        cache: rest.cache ?? "no-store",
        credentials: rest.credentials ?? "include",
      }).finally(() => {
        inflight.delete(key);
      });
      inflight.set(
        key,
        request.then((response) => response.clone()),
      );
      shared = request;
    }
  } else {
    shared = fetch(input, {
      ...rest,
      signal,
      cache: rest.cache ?? "no-store",
      credentials: rest.credentials ?? "include",
    });
  }

  return signal ? withCallerSignal(shared, signal) : shared;
}

export function clearMemoryFetchInflight(): void {
  inflight.clear();
}
