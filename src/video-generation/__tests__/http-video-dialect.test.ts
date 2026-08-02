import { describe, expect, it } from "vitest";
import {
  buildArkCreateUrl,
  buildSd2CreateUrl,
  buildSd2NormalAssetUploadUrl,
  buildSd2RealPersonAssetUploadUrl,
  clampArkVideoDurationSeconds,
  DEFAULT_ARK_VIDEO_MODEL,
  DEFAULT_SD2_VIDEO_MODEL,
  detectHttpVideoDialect,
  mapArkSizeToProviderResolution,
  normalizeArkVideoModelId,
  normalizeSd2VideoModelId,
  normalizeHttpVideoBaseUrl,
  toArkResolution,
} from "@/video-generation/provider/http-video-dialect";

describe("http-video-dialect", () => {
  it("纠正 bejing 拼写并识别方舟方言", () => {
    const url = "https://ark.cn-bejing.volces.com/api/v3";
    expect(normalizeHttpVideoBaseUrl(url)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    );
    expect(detectHttpVideoDialect(url)).toBe("ark");
    expect(buildArkCreateUrl(url)).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    );
  });

  it("480P 映射为方舟 480p", () => {
    expect(toArkResolution("480P")).toBe("480p");
    expect(toArkResolution("720P")).toBe("720p");
    expect(toArkResolution("1080P")).toBe("1080p");
  });

  it("从方舟 size 推断短边分辨率档位", () => {
    expect(mapArkSizeToProviderResolution("854x480")).toBe("480");
    expect(mapArkSizeToProviderResolution("480x854")).toBe("480");
    expect(mapArkSizeToProviderResolution("1280x720")).toBe("720");
  });

  it("识别 openai-videos、sd2 与 legacy", () => {
    expect(detectHttpVideoDialect("https://www.geeknow.top/v1/videos")).toBe(
      "openai-videos",
    );
    expect(
      detectHttpVideoDialect("https://api.example.com/v1/video/generations"),
    ).toBe("sd2");
    expect(
      detectHttpVideoDialect("https://api.example.com/api/real-person-assets"),
    ).toBe("sd2");
    expect(detectHttpVideoDialect("http://36.212.37.227:3099")).toBe("sd2");
    expect(
      detectHttpVideoDialect("http://36.212.37.227:3099/v1/video/generations"),
    ).toBe("sd2");
    expect(detectHttpVideoDialect("https://example.com/generate")).toBe(
      "legacy-sync",
    );
  });

  it("SD2 URL 构建与模型归一化", () => {
    expect(buildSd2CreateUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1/video/generations",
    );
    expect(
      buildSd2CreateUrl("https://api.example.com/v1/video/generations"),
    ).toBe("https://api.example.com/v1/video/generations");
    expect(buildSd2NormalAssetUploadUrl("https://api.example.com")).toBe(
      "https://api.example.com/api/assets/upload",
    );
    expect(buildSd2RealPersonAssetUploadUrl("https://api.example.com")).toBe(
      "https://api.example.com/api/real-person-assets/upload",
    );
    expect(normalizeSd2VideoModelId("Doubao-Seedance-2.0")).toBe(
      DEFAULT_SD2_VIDEO_MODEL,
    );
    expect(normalizeSd2VideoModelId(DEFAULT_ARK_VIDEO_MODEL)).toBe(
      DEFAULT_SD2_VIDEO_MODEL,
    );
  });

  it("控制台登录页不识别为方舟 API", () => {
    expect(
      detectHttpVideoDialect(
        "https://console.volcengine.com/auth/login/user/2124120134",
      ),
    ).toBe("legacy-sync");
  });

  it("归一化方舟展示名模型到可调用 ID", () => {
    expect(normalizeArkVideoModelId("Doubao-Seedance-2.0")).toBe(
      DEFAULT_ARK_VIDEO_MODEL,
    );
    expect(normalizeArkVideoModelId("GH seedance2.0")).toBe(
      DEFAULT_ARK_VIDEO_MODEL,
    );
    expect(normalizeArkVideoModelId("ep-20260101-xxxx")).toBe(
      "ep-20260101-xxxx",
    );
    expect(normalizeArkVideoModelId(DEFAULT_ARK_VIDEO_MODEL)).toBe(
      DEFAULT_ARK_VIDEO_MODEL,
    );
  });

  it("Seedance 时长钳制到 4–15 秒", () => {
    expect(clampArkVideoDurationSeconds(3, DEFAULT_ARK_VIDEO_MODEL)).toBe(4);
    expect(clampArkVideoDurationSeconds(5, DEFAULT_ARK_VIDEO_MODEL)).toBe(5);
    expect(clampArkVideoDurationSeconds(20, DEFAULT_ARK_VIDEO_MODEL)).toBe(15);
    expect(clampArkVideoDurationSeconds(3, "http-other")).toBe(3);
  });
});
