import { NextResponse } from "next/server";

/** Reserved generation endpoint — UI uses mock adapter until backend is wired. */
export async function POST() {
  return NextResponse.json(
    {
      error: "音色生成 API 尚未接入，请使用前端 Mock Adapter",
      mock: true,
    },
    { status: 501 },
  );
}
