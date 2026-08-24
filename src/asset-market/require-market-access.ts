import "server-only";

import { NextResponse } from "next/server";
import {
  userHasMarketAssetPermission,
  type MarketAssetPermission,
} from "@/auth/market-assets-permissions";
import { requireAuthenticatedUser } from "@/auth/require-access";

export async function requireMarketAssetPermission(
  permission: MarketAssetPermission,
) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated;
  if (!userHasMarketAssetPermission(gated.user, permission)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "无权执行此操作" }, { status: 403 }),
    };
  }
  return gated;
}
