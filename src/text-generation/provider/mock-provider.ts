import type { TextGenerationProvider, ProviderTextGenerationInput } from "@/text-generation/provider/types";
import type { ProviderTextStreamEvent } from "@/text-generation/types";

export type MockTextRequestRecord = {
  systemPrompt: string;
  userPrompt: string;
  at: string;
};

let lastMockTextRequest: MockTextRequestRecord | null = null;
let mockTextCallCount = 0;

export function getLastMockTextRequest(): MockTextRequestRecord | null {
  return lastMockTextRequest;
}

export function clearLastMockTextRequest(): void {
  lastMockTextRequest = null;
  mockTextCallCount = 0;
}

export function getMockTextCallCount(): number {
  return mockTextCallCount;
}

/** 开发/测试用流式假提供商，不产生真实费用 */
export class MockTextProvider implements TextGenerationProvider {
  estimateInputTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 2));
  }

  estimateMaxOutputTokens(
    targetChars: number,
    factor: number,
    cap: number,
  ): number {
    return Math.min(cap, Math.ceil(targetChars * factor) + 32);
  }

  async *streamText(
    input: ProviderTextGenerationInput,
  ): AsyncGenerator<ProviderTextStreamEvent, void, unknown> {
    mockTextCallCount += 1;
    const lastUser =
      input.messages
        ?.filter((m) => m.role === "user")
        .map((m) => m.content)
        .at(-1) ?? input.userPrompt;
    const systemJoined =
      input.messages
        ?.filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n") || input.systemPrompt;
    const userJoined =
      input.messages
        ?.map((m) => m.content)
        .join("\n") || input.userPrompt;
    lastMockTextRequest = {
      systemPrompt: systemJoined,
      userPrompt: lastUser,
      at: new Date().toISOString(),
    };
    const seed = lastUser
      .replace(/^创作材料：\n/, "")
      .replace(
        /\[UNTRUSTED_PROJECT_DATA\][\s\S]*?<DATA[^>]*>\n?([\s\S]*?)\n?<\/DATA>/,
        "$1",
      )
      .slice(0, 40);
    const isScriptSplit =
      /script split blocks|块边界|startBlockId|【剧本块列表】/.test(
        systemJoined + userJoined,
      );
    const redesignMatch = /^(.+?)重新设计/.exec(lastUser.trim());
    const isRosterPhase =
      /ASSET_ROSTER_PHASE|asset\.roster\.extract|Roster phase ONLY|script-roster-chunk/.test(
        systemJoined + userJoined,
      );
    const isDetailPhase =
      /ASSET_DETAIL_PHASE|asset\.detail\.extract|Detail phase ONLY|asset-detail-batch/.test(
        systemJoined + userJoined,
      );
    const isEpisodeAssetDesign =
      !redesignMatch &&
      !isRosterPhase &&
      !isDetailPhase &&
      /影视资产策划师|episode_asset_design|"assets":\[\{"type"/.test(
        systemJoined + userJoined,
      );
    const isEpisodes = /version.:1|"episodes"|正式剧集正文|恰好 1 集/.test(
      systemJoined,
    ) && !isScriptSplit && !isEpisodeAssetDesign;
    const isOutline = /剧本大纲|规划文本/.test(systemJoined);

    let body: string;
    if (redesignMatch) {
      const name = redesignMatch[1]!.trim() || "角色";
      body =
        `${name}，横构图电影剧照，虚构角色立于写实场景中，真实皮肤质感与自然光影，` +
        "精细服装材质，电影灯光与浅景深，高细节，16:9画幅，可直接用于素材生成的完整连贯中文提示词正文。";
    } else if (
      /"output_contract"\s*:\s*"ndjson"|output_contract.:.ndjson/.test(
        systemJoined + userJoined,
      )
    ) {
      let assetIds: string[] = [];
      try {
        const jsonMatch = /\{[\s\S]*"assets"\s*:\s*\[[\s\S]*\][\s\S]*\}/.exec(
          lastUser,
        );
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            assets?: Array<{ asset_id?: string }>;
          };
          assetIds = (parsed.assets ?? [])
            .map((a) => a.asset_id?.trim() ?? "")
            .filter(Boolean);
        }
      } catch {
        assetIds = [];
      }
      if (assetIds.length === 0) {
        assetIds = [...lastUser.matchAll(/"asset_id"\s*:\s*"([^"]+)"/g)].map(
          (m) => m[1]!,
        );
      }
      const lines = assetIds.map((assetId) =>
        JSON.stringify({
          type: "asset",
          asset_id: assetId,
          prompt:
            `横构图电影剧照，虚构资产${assetId}立于写实场景中，真实材质与自然光影，` +
            "精细细节，电影灯光与浅景深，16:9画幅，可直接用于素材生成的完整连贯中文提示词正文。",
          status: "completed",
        }),
      );
      lines.push(
        JSON.stringify({
          type: "batch_end",
          completed_asset_ids: assetIds,
          failed_asset_ids: [],
          next_asset_id: "",
        }),
      );
      body = lines.join("\n");
    } else if (isScriptSplit) {
      const blockIds = [
        ...lastUser.matchAll(/\[?(B\d{6})\]?/g),
      ].map((m) => m[1]!);
      const uniqueIds = [...new Set(blockIds)];
      if (uniqueIds.length === 0) {
        uniqueIds.push("B000001");
      }
      const episodes =
        uniqueIds.length >= 2
          ? [
              {
                episodeNumber: 1,
                title: "第一集",
                startBlockId: uniqueIds[0],
                endBlockId:
                  uniqueIds[Math.floor(uniqueIds.length / 2) - 1] ??
                  uniqueIds[0],
              },
              {
                episodeNumber: 2,
                title: "第二集",
                startBlockId:
                  uniqueIds[Math.floor(uniqueIds.length / 2)] ??
                  uniqueIds[uniqueIds.length - 1],
                endBlockId: uniqueIds[uniqueIds.length - 1],
              },
            ]
          : [
              {
                episodeNumber: 1,
                title: "第一集",
                startBlockId: uniqueIds[0],
                endBlockId: uniqueIds[0],
              },
            ];
      body = JSON.stringify({ episodes });
    } else if (isRosterPhase) {
      body = JSON.stringify({
        version: 1,
        assets: [
          {
            type: "character",
            name: "林清",
            aliases: ["清清"],
            evidenceRefs: ["林清走进茶馆"],
          },
          {
            type: "scene",
            name: "雨夜茶馆",
            aliases: [],
            evidenceRefs: ["茶馆"],
          },
          {
            type: "prop",
            name: "旧伞",
            aliases: [],
            evidenceRefs: ["伞"],
          },
        ],
      });
    } else if (isDetailPhase) {
      const batchKeys = [
        ...userJoined.matchAll(
          /"assetKey"\s*:\s*"([^"]+)"/g,
        ),
      ].map((match) => match[1]!);
      const uniqueKeys = [...new Set(batchKeys)].filter(
        (key) => key.includes(":"),
      );
      const assets =
        uniqueKeys.length > 0
          ? uniqueKeys.map((assetKey) => {
              const [type, ...rest] = assetKey.split(":");
              const name = rest.join(":") || "资产";
              const assetType =
                type === "scene" || type === "prop" || type === "audio"
                  ? type
                  : "character";
              return {
                assetKey,
                type: assetType,
                name,
                description: "本批资产详情",
                design: {
                  usageInEpisode: "推动情节",
                  evidence: name,
                  ...(assetType === "character"
                    ? { role: "角色", appearance: "写实" }
                    : assetType === "scene"
                      ? { location: name, timeOfDay: "日", style: "写实" }
                      : assetType === "prop"
                        ? { propType: "道具", usage: "剧情" }
                        : { audioKind: "sfx" }),
                },
              };
            })
          : [
              {
                assetKey: "character:linqing",
                type: "character",
                name: "林清",
                design: { role: "主角", appearance: "清瘦", usageInEpisode: "开场" },
              },
            ];
      body = JSON.stringify({ version: 1, assets });
    } else if (isEpisodeAssetDesign) {
      const nameHint =
        /林清|掌柜|阿棠|雨|茶馆|铜匣|玉佩/.exec(lastUser)?.[0] ?? "旅人";
      body = JSON.stringify({
        version: 1,
        assets: [
          {
            type: "character",
            name: nameHint === "雨" ? "林清" : nameHint,
            description: "本集关键角色",
            design: {
              role: "主角",
              appearance: "清瘦",
              usageInEpisode: "推动情节",
              evidence: nameHint,
            },
          },
          {
            type: "scene",
            name: "雨夜茶馆",
            design: {
              timeOfDay: "夜",
              location: "茶馆",
              style: "写实",
              usageInEpisode: "开场",
              evidence: "茶馆",
            },
          },
          {
            type: "prop",
            name: "旧伞",
            design: {
              propType: "随身物",
              usage: "遮雨",
              usageInEpisode: "出场",
              evidence: "伞",
            },
          },
        ],
      });
    } else if (isEpisodes) {
      const numberMatch = /【目标集号】第(\d+)集/.exec(lastUser);
      const episodeNumber = numberMatch
        ? Number.parseInt(numberMatch[1]!, 10)
        : 1;
      const title = `生成集${episodeNumber}`;
      const content =
        `第${episodeNumber}集正文。` +
        `${seed || "根据大纲"}展开冲突与人物行动。` +
        "场景清晰，对白简练，收束本集。";
      body = JSON.stringify({
        version: 1,
        episodes: [{ number: episodeNumber, title, content }],
      });
    } else if (isOutline) {
      body = [
        "【故事核心】",
        `${seed || "主角"}在突变中寻找真相。`,
        "【主线冲突】",
        "理想与现实、信任与背叛的拉扯。",
        "【主要人物关系】",
        "主角、对手、引路人形成三角张力。",
        "【阶段推进】",
        "开端铺垫 → 中段升级 → 高潮对决 → 收束余韵。",
        "【结局方向】",
        "付出代价后换来有限的和解。",
      ].join("\n");
    } else {
      body =
        `在一处被霓虹浸透的雨巷里，${seed || "一位旅人"}开始了冒险。` +
        "风穿过旧招牌，像有人在低声讲述尚未写完的结局。" +
        "他停在路口，听见远处鼓点与车流交织，终于决定迈出下一步。";
    }

    const chunkSize = 12;
    for (let i = 0; i < body.length; i += chunkSize) {
      if (input.signal?.aborted) {
        yield { type: "error", code: "CANCELLED", message: "已取消" };
        return;
      }
      await new Promise((r) => setTimeout(r, 16));
      yield { type: "delta", text: body.slice(i, i + chunkSize) };
    }
    const inputTokens = this.estimateInputTokens(
      input.systemPrompt + input.userPrompt,
    );
    const outputTokens = Math.ceil(body.length / 2);
    yield {
      type: "usage",
      inputTokens,
      outputTokens,
      finishReason: "stop",
    };
    yield {
      type: "done",
      inputTokens,
      outputTokens,
      finishReason: "stop",
    };
  }
}
