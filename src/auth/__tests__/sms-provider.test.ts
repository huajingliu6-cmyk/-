import { describe, expect, it } from "vitest";
import {
  getSmsProvider,
  SmsProviderUnavailableError,
} from "@/auth/sms/provider";

describe("sms provider", () => {
  it("defaults to a disabled provider", async () => {
    const previousProvider = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;

    try {
      const provider = getSmsProvider();
      expect(provider.id).toBe("disabled");
      await expect(
        provider.sendVerificationCode({
          phoneNumber: "+8613800000000",
          code: "123456",
          purpose: "login",
          expiresInSeconds: 300,
        }),
      ).rejects.toBeInstanceOf(SmsProviderUnavailableError);
    } finally {
      if (previousProvider === undefined) delete process.env.SMS_PROVIDER;
      else process.env.SMS_PROVIDER = previousProvider;
    }
  });

  it("rejects providers that have not been implemented", () => {
    const previousProvider = process.env.SMS_PROVIDER;
    process.env.SMS_PROVIDER = "example-vendor";

    try {
      expect(() => getSmsProvider()).toThrow(
        "SMS provider is not implemented: example-vendor",
      );
    } finally {
      if (previousProvider === undefined) delete process.env.SMS_PROVIDER;
      else process.env.SMS_PROVIDER = previousProvider;
    }
  });
});
