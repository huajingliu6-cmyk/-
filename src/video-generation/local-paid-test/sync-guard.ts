import type { GenerationRecord } from "../types";
import type { WanLocalPaidTestGuardStore } from "./guard-store";
import { LocalPaidTestError } from "./errors";

/**
 * Sync Guard after poll / transfer for a local one-shot generation.
 * Never calls Provider. Never returns Guard to armed after submit.
 */
export async function syncLocalPaidTestGuardFromGeneration(options: {
  generation: GenerationRecord;
  guardStore: WanLocalPaidTestGuardStore;
}): Promise<void> {
  const { generation, guardStore } = options;
  if (!generation.localOneShotPaidTest) return;

  const guard = await guardStore.get();
  if (guard.generationId && guard.generationId !== generation.id) {
    // Inconsistent linkage — safe stop without mutating toward armed
    return;
  }

  const taskId = generation.providerTaskId || guard.providerTaskId || "";

  try {
    if (
      generation.status === "queued" ||
      generation.status === "processing" ||
      generation.status === "submitting" ||
      generation.status === "validating" ||
      generation.status === "downloading"
    ) {
      if (
        guard.state === "submitting" ||
        guard.state === "providerAccepted" ||
        guard.state === "transferPending"
      ) {
        if (taskId && guard.state === "submitting") {
          await guardStore.markProviderAccepted({
            generationId: generation.id,
            providerTaskId: taskId,
          });
        }
      }
      return;
    }

    if (generation.status === "failed") {
      if (generation.errorCode === "PROVIDER_TASK_UNKNOWN") {
        if (guard.state !== "unknownOutcome" && guard.state !== "consumed") {
          await guardStore.markUnknownOutcome({
            generationId: generation.id,
            errorCode: generation.errorCode ?? "PROVIDER_TASK_UNKNOWN",
          });
        }
        return;
      }
      if (
        guard.state !== "consumed" &&
        guard.state !== "completed" &&
        guard.state !== "unknownOutcome"
      ) {
        await guardStore.markConsumed();
      }
      return;
    }

    if (generation.status === "cancelled") {
      if (guard.state !== "consumed" && guard.state !== "completed") {
        await guardStore.markConsumed();
      }
      return;
    }

    if (generation.status === "unknownOutcome") {
      if (guard.state !== "unknownOutcome") {
        await guardStore.markUnknownOutcome({
          generationId: generation.id,
          errorCode: generation.errorCode ?? "GENERATION_SUBMISSION_UNKNOWN",
        });
      }
      return;
    }

    if (generation.status === "resultTransferFailed") {
      if (taskId) {
        if (
          guard.state === "providerAccepted" ||
          guard.state === "submitting" ||
          guard.state === "transferPending"
        ) {
          await guardStore.markTransferPending({
            generationId: generation.id,
            providerTaskId: taskId,
          });
        }
      }
      return;
    }

    if (generation.status === "completed") {
      if (guard.state !== "completed" && guard.state !== "consumed") {
        await guardStore.markCompleted({
          generationId: generation.id,
          providerTaskId: taskId || null,
        });
      }
    }
  } catch (err) {
    if (err instanceof LocalPaidTestError) {
      // Guard already in terminal / inconsistent state — do not escalate to Provider
      return;
    }
    throw err;
  }
}
