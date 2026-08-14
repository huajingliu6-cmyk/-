export const ACTIVE_ENTERPRISE_STORAGE_KEY = "lumina:active-enterprise-id";
export const ACTIVE_ENTERPRISE_EVENT = "lumina:active-enterprise-changed";

export type ActiveSpace =
  | { kind: "personal" }
  | { kind: "enterprise"; enterpriseId: string };

export function readActiveSpace(): ActiveSpace {
  if (typeof window === "undefined") return { kind: "personal" };
  const enterpriseId = window.localStorage
    .getItem(ACTIVE_ENTERPRISE_STORAGE_KEY)
    ?.trim();
  return enterpriseId
    ? { kind: "enterprise", enterpriseId }
    : { kind: "personal" };
}

export function writeActiveSpace(space: ActiveSpace): void {
  if (typeof window === "undefined") return;
  if (space.kind === "enterprise") {
    window.localStorage.setItem(ACTIVE_ENTERPRISE_STORAGE_KEY, space.enterpriseId);
  } else {
    window.localStorage.removeItem(ACTIVE_ENTERPRISE_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_ENTERPRISE_EVENT, { detail: space }));
}
