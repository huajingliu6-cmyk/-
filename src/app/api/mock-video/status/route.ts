import { NextResponse } from "next/server";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { validateMockVideoSource } from "@/video-generation/validate-mock-video-source";

export async function GET() {
  const provider = (process.env.VIDEO_PROVIDER ?? "mock").trim().toLowerCase();
  const isMock = provider === "" || provider === "mock";
  if (!isMock) {
    return NextResponse.json({
      provider,
      needed: false,
      configured: true,
      code: null as string | null,
      message: null as string | null,
      relativeHint: null,
    });
  }

  if (isRemoteDataOnly()) {
    return NextResponse.json({
      provider: "mock",
      needed: true,
      configured: false,
      code: "REMOTE_MOCK_SOURCE_NOT_CONFIGURED",
      message: "远程/生产模式不读取 Web 本地 Mock 文件；请由内网业务服务提供 Mock 结果。",
      relativeHint: null,
    });
  }

  const result = await validateMockVideoSource();
  if (result.ok) {
    return NextResponse.json({
      provider: "mock",
      needed: true,
      configured: true,
      code: null,
      message: null,
      relativeHint: "data/mock/mock-video.mp4",
    });
  }

  return NextResponse.json({
    provider: "mock",
    needed: true,
    configured: false,
    code: result.code,
    message: result.message,
    relativeHint: "data/mock/mock-video.mp4",
  });
}