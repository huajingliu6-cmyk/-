import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/auth/require-user";
import {
  FileWanLocalPaidTestGuardStore,
  LocalPaidTestError,
  armLocalPaidTest,
  LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
} from "@/video-generation/local-paid-test";

const bodySchema = z.object({
  token: z.string().min(1).max(512),
  confirmationPhrase: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "LOCAL_PAID_TEST_CONFIRMATION_INVALID",
          message: "确认信息不完整。",
        },
        { status: 400 },
      );
    }

    // 不记录 token
    const store = new FileWanLocalPaidTestGuardStore({ namespace: "live" });
    const guard = await armLocalPaidTest({
      store,
      token: parsed.data.token,
      confirmationPhrase: parsed.data.confirmationPhrase,
      hasActiveGeneration: false,
    });

    return NextResponse.json({
      ok: true,
      guard: {
        state: guard.state,
        armedAt: guard.armedAt,
        updatedAt: guard.updatedAt,
      },
      confirmationPhraseRequired: LOCAL_PAID_TEST_CONFIRMATION_PHRASE,
      notice: "已武装：尚未调用 Provider，不会产生费用。",
    });
  } catch (err) {
    if (err instanceof LocalPaidTestError) {
      const status =
        err.code === "LOCAL_PAID_TEST_NOT_ALLOWED_IN_PRODUCTION"
          ? 403
          : err.code === "LOCAL_PAID_TEST_TOKEN_INVALID" ||
              err.code === "LOCAL_PAID_TEST_CONFIRMATION_INVALID"
            ? 401
            : 400;
      return NextResponse.json(
        { code: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      { code: "LOCAL_PAID_TEST_GUARD_UNAVAILABLE", message: "武装失败。" },
      { status: 503 },
    );
  }
}
