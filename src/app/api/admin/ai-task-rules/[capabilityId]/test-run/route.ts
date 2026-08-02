import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { assembleTextSystemPrompt, assembleUntrustedUserData } from "@/ai-config/prompt-assembly";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { buildPlatformSystemPolicy } from "@/ai-config/system-policy";
import {
  getEffectivePublishedRule,
  getRuleRecord,
} from "@/ai-config/task-rules-store";
import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import {
  aiConfigErrorResponse,
  parseCapabilityId,
} from "@/app/api/admin/ai-admin-helpers";
import { AiConfigError } from "@/ai-config/errors";

type RouteContext = { params: Promise<{ capabilityId: string }> };

const SAFE_TEST_DATA = "【试运行】隔离测试数据 — 不包含真实项目内容。";

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }

  let body: { confirmPaid?: boolean; useDraft?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty ok
  }

  try {
    const record = await getRuleRecord(capabilityId);
    const draftContent = record.draft?.content;
    const effective = await getEffectivePublishedRule(capabilityId);
    const useDraft = body.useDraft !== false && !!draftContent?.trim();
    const taskRuleContent = useDraft ? draftContent! : effective.content;

    const systemPrompt = assembleTextSystemPrompt({
      systemPolicy: buildPlatformSystemPolicy(capabilityId),
      taskRule: taskRuleContent,
      taskRuleSource: useDraft ? "custom" : effective.source,
      outputContract: buildImmutableOutputContract(capabilityId),
    });
    const userPrompt = assembleUntrustedUserData("test-run", SAFE_TEST_DATA);

    let providerMode = "mock";
    try {
      const plan = await resolveAiExecutionPlan({
        capabilityId,
        dynamicInput: SAFE_TEST_DATA,
        userId: auth.user.id,
      });
      providerMode = plan.modelConnection.providerMode;
    } catch (err) {
      if (
        !(err instanceof AiConfigError) ||
        (err.code !== "AI_CAPABILITY_PLANNED" && err.code !== "AI_MODEL_UNBOUND")
      ) {
        throw err;
      }
    }

    if (providerMode !== "mock" && !body.confirmPaid) {
      return NextResponse.json(
        {
          error: "非 Mock 试运行可能产生费用，请 confirmPaid",
          code: "AI_PAID_CONFIRMATION_REQUIRED",
        },
        { status: 400 },
      );
    }

    const provider = new MockTextProvider();
    const started = Date.now();
    let text = "";
    for await (const event of provider.streamText({
      systemPrompt,
      userPrompt,
      providerModelId: "mock-test-run",
      maxOutputTokens: 200,
    })) {
      if (event.type === "delta") text += event.text;
    }

    return NextResponse.json({
      success: true,
      latencyMs: Date.now() - started,
      providerMode: "mock",
      outputPreview: text.slice(0, 500),
      outputLength: text.length,
      usedDraft: useDraft,
      note: "试运行不写入项目数据；始终使用 Mock Provider 安全试跑",
    });
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
