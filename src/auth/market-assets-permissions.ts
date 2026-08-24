import type { AuthUser } from "@/auth/types";
import { getSystemRole } from "@/auth/roles";

export const MARKET_ASSET_PERMISSIONS = [
  "market_assets.read",
  "market_assets.use",
  "market_assets.create",
  "market_assets.update",
  "market_assets.publish",
  "market_assets.delete",
  "market_assets.audit",
] as const;

export type MarketAssetPermission = (typeof MARKET_ASSET_PERMISSIONS)[number];

const USER_READ_PERMISSIONS = new Set<MarketAssetPermission>([
  "market_assets.read",
  "market_assets.use",
]);

const ADMIN_PERMISSIONS = new Set<MarketAssetPermission>(MARKET_ASSET_PERMISSIONS);

export function userHasMarketAssetPermission(
  user: AuthUser,
  permission: MarketAssetPermission,
): boolean {
  if (getSystemRole(user) === "SYSTEM_ADMIN") {
    return ADMIN_PERMISSIONS.has(permission);
  }
  return USER_READ_PERMISSIONS.has(permission);
}
