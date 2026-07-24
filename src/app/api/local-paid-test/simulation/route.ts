import { NextResponse } from "next/server";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { requireAdminUser } from "@/auth/require-user";
import {
  LocalPaidTestError,
  assertCanUseLocalPaidTestGate,
  isDevelopmentNodeEnv,
  runLocalPaidTestSimulation,
} from "@/video-generation/local-paid-test";

/**
 * 零费用 Simulation：临时目录，不写正式 data/generations / 幂等 / 视频。
 */
export async function POST() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  try {
    if (!isDevelopmentNodeEnv()) {
      throw new LocalPaidTestError("LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION");
    }
    // 允许在未开启真实模式时仍跑 simulation（开发演练），但生产拒绝。
    // 若开启了模式，则额外校验闸门环境。
    if (process.env.WAN_LOCAL_PAID_TEST_MODE?.trim().toLowerCase() === "true") {
      assertCanUseLocalPaidTestGate();
    }

    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `wan-sim-guard-${randomUUID()}-`),
    );
    try {
      const result = await runLocalPaidTestSimulation({
        rootDir,
        scenario: "happy-path",
      });
      return NextResponse.json({
        ok: true,
        ...result,
        notice: "Simulation 完成：未访问网络、未产生费用、未写正式记录。",
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof LocalPaidTestError) {
      return NextResponse.json(
        { code: err.code, message: err.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: "LOCAL_PAID_TEST_GUARD_UNAVAILABLE", message: "Simulation 失败。" },
      { status: 503 },
    );
  }
}
