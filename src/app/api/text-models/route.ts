import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  getRecommendedModelKey,
  listPublicTextModels,
} from "@/text-generation/model-registry";

/** 公开模型列表（不含密钥与内部成本） */
export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  return NextResponse.json({
    models: listPublicTextModels(),
    recommendedKey: getRecommendedModelKey(),
  });
}
