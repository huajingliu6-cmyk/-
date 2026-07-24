import type {
  ProviderCancelResult,
  ProviderCapabilities,
  ProviderGenerationInput,
  ProviderStatusResult,
  ProviderSubmitResult,
  VideoProviderId,
} from "../types";

export interface VideoProvider {
  readonly id: VideoProviderId;

  submitGeneration(
    input: ProviderGenerationInput,
  ): Promise<ProviderSubmitResult>;

  getGenerationStatus(
    providerTaskId: string,
  ): Promise<ProviderStatusResult>;

  cancelGeneration(
    providerTaskId: string,
  ): Promise<ProviderCancelResult>;

  getCapabilities(): ProviderCapabilities;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
