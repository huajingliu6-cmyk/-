import {
  formatLocalDateYmd,
  getLocalPaidTestRuntimeConfig,
  isValidPriceConfirmedOn,
  validateMaxCostCny,
  assertLocalPaidTestEnvironmentAllowed,
} from "./config";
import { LocalPaidTestError } from "./errors";
import type { WanLocalPaidTestGuardStore } from "./guard-store";
import type { WanLocalPaidTestGuardRecord } from "./types";
import {
  assertValidConfirmationPhrase,
  assertValidLocalPaidTestToken,
} from "./token";

/**
 * Arm：验证环境 / Token / 价格 / 确认短语 / Guard 可 arm。
 * 不调用 Provider，不创建 generation。
 */
export async function armLocalPaidTest(options: {
  env?: Record<string, string | undefined>;
  store: WanLocalPaidTestGuardStore;
  token: string;
  confirmationPhrase: string;
  hasActiveGeneration?: boolean;
  requestFingerprint?: string | null;
}): Promise<WanLocalPaidTestGuardRecord> {
  const env = options.env ?? process.env;
  assertLocalPaidTestEnvironmentAllowed(env);

  const cfg = getLocalPaidTestRuntimeConfig(env);
  if (!cfg.localPaidTestMode) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_DISABLED");
  }

  assertValidLocalPaidTestToken(options.token, cfg.token);
  assertValidConfirmationPhrase(options.confirmationPhrase);

  const today = formatLocalDateYmd();
  if (!cfg.priceConfirmedOn.trim()) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_PRICE_NOT_CONFIRMED");
  }
  if (!isValidPriceConfirmedOn(cfg.priceConfirmedOn, today)) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_PRICE_CONFIRMATION_EXPIRED");
  }

  const maxOk = validateMaxCostCny(cfg.maxCostCny);
  if (!maxOk.ok) {
    throw new LocalPaidTestError(maxOk.code);
  }

  if (options.hasActiveGeneration) {
    throw new LocalPaidTestError("LOCAL_PAID_TEST_ACTIVE_GENERATION_EXISTS");
  }

  return options.store.arm({
    requestFingerprint: options.requestFingerprint ?? null,
  });
}
