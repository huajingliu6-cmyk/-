import {
  getVideoProviderRuntimeConfig,
  type VideoProviderRuntimeConfig,
} from "./config";
import { AliyunWan27VideoProvider } from "./aliyun-wan27-provider";
import { MockVideoProvider } from "./mock-provider";
import type { FetchLike, VideoProvider } from "./types";

export function createVideoProvider(options?: {
  config?: VideoProviderRuntimeConfig;
  fetchImpl?: FetchLike;
}): VideoProvider {
  const config = options?.config ?? getVideoProviderRuntimeConfig();
  if (config.providerId === "aliyun-wan27") {
    return new AliyunWan27VideoProvider({
      config,
      fetchImpl: options?.fetchImpl,
    });
  }
  return new MockVideoProvider();
}

export type { VideoProvider } from "./types";
export { MockVideoProvider } from "./mock-provider";
export { AliyunWan27VideoProvider } from "./aliyun-wan27-provider";
export { buildWan27ProviderReadinessReport } from "./wan27-readiness";
export { buildWan27DryRunPreview } from "./wan27-dry-run";
export { mapWan27ProviderError } from "./wan27-error-map";
export {
  WAN27_RECOMMENDED_POLL_INTERVAL_MS,
  MOCK_POLL_INTERVAL_MS,
  WAN27_UI_COST_NOTICE,
} from "./wan27-constants";
