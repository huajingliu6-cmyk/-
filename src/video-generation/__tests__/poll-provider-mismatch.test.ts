import { afterEach, describe, expect, it } from "vitest";
import {
  MockVideoProvider,
  resetMockVideoProviderTasks,
} from "@/video-generation/provider/mock-provider";
import { createVideoProvider } from "@/video-generation/provider";

afterEach(() => {
  resetMockVideoProviderTasks();
});

describe("poll must not use Mock for http-ark task ids", () => {
  it("MockProvider refuses unknown non-mock task ids", async () => {
    const mock = new MockVideoProvider();
    const status = await mock.getGenerationStatus(
      "http-ark-cgt-20260725164815-k6z24",
    );
    expect(status.status).toBe("failed");
    expect(status.errorCode).toBe("MOCK_TASK_NOT_FOUND");
  });

  it("createVideoProvider with providerId=http does not return mock", () => {
    const provider = createVideoProvider({
      config: {
        providerId: "http",
        allowPaidGeneration: false,
        dashscopeApiKey: "",
        dashscopeWorkspaceId: "",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "doubao-seedance-2-0-260128",
        r2vModelId: "doubao-seedance-2-0-260128",
        httpApiUrl: "https://ark.cn-beijing.volces.com/api/v3",
        httpApiKey: "sk-test-key-demo",
        httpModelId: "doubao-seedance-2-0-260128",
      },
    });
    expect(provider.id).toBe("http");
  });
});
