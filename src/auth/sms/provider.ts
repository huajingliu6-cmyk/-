import "server-only";

export type SmsVerificationPurpose =
  | "login"
  | "register"
  | "bind-phone"
  | "change-phone";

export type SendSmsVerificationCodeInput = {
  phoneNumber: string;
  code: string;
  purpose: SmsVerificationPurpose;
  expiresInSeconds: number;
};

export type SendSmsVerificationCodeResult = {
  providerMessageId?: string;
};

export interface SmsProvider {
  readonly id: string;
  sendVerificationCode(
    input: SendSmsVerificationCodeInput,
  ): Promise<SendSmsVerificationCodeResult>;
}

export class SmsProviderUnavailableError extends Error {
  constructor(message = "SMS provider is not configured") {
    super(message);
    this.name = "SmsProviderUnavailableError";
  }
}

class DisabledSmsProvider implements SmsProvider {
  readonly id = "disabled";

  async sendVerificationCode(): Promise<SendSmsVerificationCodeResult> {
    throw new SmsProviderUnavailableError();
  }
}

const disabledSmsProvider = new DisabledSmsProvider();

export function getSmsProvider(): SmsProvider {
  const providerId = process.env.SMS_PROVIDER?.trim().toLowerCase() || "disabled";
  if (providerId === "disabled") return disabledSmsProvider;
  throw new SmsProviderUnavailableError(`SMS provider is not implemented: ${providerId}`);
}
