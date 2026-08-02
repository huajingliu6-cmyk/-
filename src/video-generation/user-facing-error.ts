/**
 * 将 Provider / 方舟原始错误转为用户可读说明（尤其是内容审核类）。
 */

export type VideoUserErrorKind =
  | "moderation"
  | "certification"
  | "config"
  | "duration"
  | "reference"
  | "generic";

export type VideoUserFacingError = {
  kind: VideoUserErrorKind;
  /** 短标题，适合徽章旁 */
  title: string;
  /** 完整说明，适合预览区 / 提示条 */
  message: string;
};

const SD2_CERT_CODES = [
  "SD2_REAL_PERSON_CERT_FAILED",
  "SD2_REAL_PERSON_CERT_BLOCKED",
  "SD2_REAL_PERSON_CERT_TIMEOUT",
] as const;

function extractArkPayload(raw: string): string {
  const m = raw.match(/方舟创建任务失败（\d+）：\s*(.+)$/s);
  if (m?.[1]) return m[1].replace(/\s*Request id:.*$/i, "").trim();
  return raw.replace(/\s*Request id:.*$/i, "").trim();
}

/** 移动 SD2 真人素材认证失败（应阻断提交，不可按方舟逻辑 omit 人物重试） */
export function isSd2RealPersonCertError(
  codeOrMessage: string | null | undefined,
): boolean {
  const text = (codeOrMessage ?? "").trim();
  if (!text) return false;
  if (SD2_CERT_CODES.some((c) => text === c || text.includes(c))) return true;
  return (
    /真人素材认证失败|真人素材认证超时|真人素材已被平台禁止|SD2_REAL_PERSON_CERT_/i.test(
      text,
    ) ||
    (/真人素材/.test(text) && /blocked|禁止使用/i.test(text))
  );
}

export function classifyVideoProviderError(
  raw: string | null | undefined,
): VideoUserFacingError {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      kind: "generic",
      title: "生成失败",
      message: "视频生成失败，请稍后重试。",
    };
  }

  const payload = extractArkPayload(text);

  if (isSd2RealPersonCertError(text)) {
    if (/超时|TIMEOUT/i.test(text)) {
      return {
        kind: "certification",
        title: "真人认证超时",
        message:
          "真人素材认证超时：平台未在时限内返回 active。请稍后重试，或换图后重新提交；勿反复空提交以免占额度。",
      };
    }
    if (/blocked|禁止使用|BLOCKED/i.test(text)) {
      return {
        kind: "certification",
        title: "真人素材已禁止",
        message:
          "该人物参考图已被平台禁止用于视频生成（blocked）。请更换人物图或去掉该人物参考后重试。",
      };
    }
    const detail = text
      .replace(/^真人素材认证失败/, "")
      .replace(/^[（(][^）)]+[）)]/, "")
      .replace(/^[：:]\s*/, "")
      .trim();
    return {
      kind: "certification",
      title: "真人认证失败",
      message: detail
        ? `真人素材认证失败：${detail}`
        : "真人素材认证失败：请重新上传人物参考图，或联系平台处理后再提交。",
    };
  }

  // 已是产品文案时不再二次包装
  if (/^内容审核未通过/.test(text)) {
    return {
      kind: "moderation",
      title: "内容审核未通过",
      message: text,
    };
  }

  if (/real person|真实人物|真人照片|疑似真人/i.test(text)) {
    return {
      kind: "moderation",
      title: "内容审核未通过",
      message:
        "内容审核未通过：参考图疑似包含真人照片。请改用更偏插画/设定图风格的人物图，或暂时去掉人物参考后重试。",
    };
  }

  if (
    /moderat|content.?polic|sensitive|违规|审核未通过|审核失败|不符合.*规范|涉政|色情|暴力/i.test(
      text,
    )
  ) {
    const detail =
      payload && !/^方舟/.test(payload)
        ? payload
        : "提示词或参考图未通过平台审核，请修改后重试。";
    return {
      kind: "moderation",
      title: "内容审核未通过",
      message: `内容审核未通过：${detail}`,
    };
  }

  if (/does not exist|do not have access|不存在|无权/i.test(text)) {
    return {
      kind: "config",
      title: "模型配置无效",
      message:
        "视频模型或接入点无效/无权限。请到「管理 API → 视频镜头」填写可用的模型 ID 或 ep-xxxx。",
    };
  }

  if (/duration.*not valid|duration.*invalid/i.test(text)) {
    return {
      kind: "duration",
      title: "时长不符合要求",
      message:
        "视频时长不符合当前模型要求（Seedance 参考生视频一般为 4–15 秒）。请调整镜头时长后重试。",
    };
  }

  if (/image_url.*not valid|image_url.*invalid/i.test(text)) {
    return {
      kind: "reference",
      title: "参考图无效",
      message:
        "参考图无法被视频服务读取。请确认人物/场景已绑定可用图片后重试。",
    };
  }

  if (/幂等键/.test(text)) {
    return {
      kind: "generic",
      title: "请重新提交",
      message: "上次提交状态冲突，请再点一次「生成本镜头视频」。",
    };
  }

  return {
    kind: "generic",
    title: "生成失败",
    message: payload.length > 280 ? `${payload.slice(0, 280)}…` : payload,
  };
}

/** 单行展示（提示条 / setNote） */
export function formatVideoProviderErrorForUser(
  raw: string | null | undefined,
): string {
  return classifyVideoProviderError(raw).message;
}

/** 是否为「疑似真人」类内容审核拒绝（可自动去掉人物参考后重试；不含 SD2 认证失败） */
export function isRealPersonModerationError(
  raw: string | null | undefined,
): boolean {
  const text = (raw ?? "").trim();
  if (!text) return false;
  if (isSd2RealPersonCertError(text)) return false;
  return /real person|真实人物|真人照片|疑似真人/i.test(text);
}
