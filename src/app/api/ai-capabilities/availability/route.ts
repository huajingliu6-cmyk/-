import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { listCapabilityAvailabilities } from "@/ai-config/resolve";

/**
 * Safe availability probe for UI buttons.
 * Never returns Base URL, API keys, or adapter internals.
 */
export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const items = await listCapabilityAvailabilities();
  return NextResponse.json({
    capabilities: items.map((item) => ({
      capabilityId: item.capabilityId,
      available: item.available,
      reasonCode: item.reasonCode,
      status: item.status,
      label: item.label,
    })),
  });
}
