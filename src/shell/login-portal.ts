export const LOGIN_PORTAL_STORAGE_KEY = 'ic_login_portal_once';

export type LoginPortalPayload = {
  v: 1;
  target: string;
  createdAt: number;
};

let pendingLoginPortal: LoginPortalPayload | null = null;

export function writeLoginPortalFlag(target: string): void {
  pendingLoginPortal = {
    v: 1,
    target,
    createdAt: Date.now(),
  };
}

export function consumeLoginPortalFlag(): LoginPortalPayload | null {
  const payload = pendingLoginPortal;
  pendingLoginPortal = null;
  if (!payload || Date.now() - payload.createdAt > 15_000) return null;
  return payload;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
