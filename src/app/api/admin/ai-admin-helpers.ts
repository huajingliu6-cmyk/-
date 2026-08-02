import { NextResponse } from "next/server";
import { AiConfigError } from "@/ai-config/errors";
import { getAiCapability, type AiCapabilityId } from "@/ai-config/capabilities";

export function aiConfigErrorResponse(err: unknown, fallback = "操作失败") {
  if (err instanceof AiConfigError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.code.includes("CONFLICT") ? 409 : 400 },
    );
  }
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 400 });
}

export function parseCapabilityId(raw: string | undefined): AiCapabilityId | null {
  if (!raw) return null;
  const cap = getAiCapability(raw);
  return cap?.id ?? null;
}

export function capabilitySlug(capabilityId: string): string {
  return capabilityId.replace(/\./g, "-");
}
