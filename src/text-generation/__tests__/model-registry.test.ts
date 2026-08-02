import { describe, expect, it } from "vitest";
import {
  getTextModelByKey,
  listPublicTextModels,
} from "@/text-generation/model-registry";

describe("text model registry", () => {
  it("公开列表不含密钥与内部定价字段", () => {
    const models = listPublicTextModels();
    expect(models.length).toBeGreaterThan(0);
    const json = JSON.stringify(models);
    expect(json).not.toContain("pointsPer1k");
    expect(json).not.toContain("providerModelId");
    expect(json).not.toContain("apiKey");
  });

  it("拒绝任意客户端模型 ID", () => {
    expect(getTextModelByKey("gpt-4o")).toBeNull();
    expect(getTextModelByKey("qwen-max-secret")).toBeNull();
    expect(getTextModelByKey("balanced-default")).not.toBeNull();
  });
});
