import { describe, expect, it } from "vitest";
import {
  classifyVideoProviderError,
  formatVideoProviderErrorForUser,
  isRealPersonModerationError,
  isSd2RealPersonCertError,
} from "@/video-generation/user-facing-error";

describe("formatVideoProviderErrorForUser", () => {
  it("maps real-person moderation to Chinese guidance", () => {
    const raw =
      "方舟创建任务失败（400）：The request failed because the input image 'content[1]' may contain real person. Request id: abc";
    const classified = classifyVideoProviderError(raw);
    expect(classified.kind).toBe("moderation");
    expect(classified.title).toBe("内容审核未通过");
    expect(formatVideoProviderErrorForUser(raw)).toContain("真人照片");
  });

  it("maps model 404", () => {
    const msg = formatVideoProviderErrorForUser(
      "方舟创建任务失败（404）：The model or endpoint X does not exist",
    );
    expect(msg).toContain("管理 API");
  });

  it("keeps already Chinese moderation copy", () => {
    const msg =
      "内容审核未通过：参考图疑似包含真人照片。请改用更偏插画/设定图风格的人物图，或暂时去掉人物参考后重试。";
    expect(formatVideoProviderErrorForUser(msg)).toBe(msg);
  });

  it("maps SD2 cert failed / blocked / timeout", () => {
    const failed = classifyVideoProviderError(
      "真人素材认证失败（江宸）：平台拒绝",
    );
    expect(failed.kind).toBe("certification");
    expect(failed.title).toBe("真人认证失败");
    expect(failed.message).toContain("认证失败");

    const blocked = classifyVideoProviderError(
      "真人素材已被平台禁止使用（blocked）（江宸）",
    );
    expect(blocked.kind).toBe("certification");
    expect(blocked.title).toBe("真人素材已禁止");

    const timeout = classifyVideoProviderError(
      "真人素材认证超时（江宸）：等待真人认证…",
    );
    expect(timeout.kind).toBe("certification");
    expect(timeout.title).toBe("真人认证超时");
  });
});

describe("isSd2RealPersonCertError / isRealPersonModerationError", () => {
  it("detects SD2 cert codes and messages", () => {
    expect(isSd2RealPersonCertError("SD2_REAL_PERSON_CERT_FAILED")).toBe(true);
    expect(isSd2RealPersonCertError("SD2_REAL_PERSON_CERT_BLOCKED")).toBe(true);
    expect(isSd2RealPersonCertError("SD2_REAL_PERSON_CERT_TIMEOUT")).toBe(true);
    expect(isSd2RealPersonCertError("真人素材认证失败：x")).toBe(true);
  });

  it("does not treat SD2 cert failures as Ark omit-retry moderation", () => {
    expect(
      isRealPersonModerationError("真人素材认证失败（江宸）：平台拒绝"),
    ).toBe(false);
    expect(
      isRealPersonModerationError("真人素材已被平台禁止使用（blocked）"),
    ).toBe(false);
    expect(
      isRealPersonModerationError(
        "The request failed because the input image may contain real person",
      ),
    ).toBe(true);
  });
});
