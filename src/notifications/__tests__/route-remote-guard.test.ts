import { describe, expect, it, vi } from "vitest";

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataServiceError: (error: unknown) =>
    error instanceof Error && error.message === "REMOTE_DATA_UNAVAILABLE",
}));

import { guardNotificationRemoteData } from "@/notifications/route-remote-guard";

describe("notification remote route guard", () => {
  it("maps remote service failures to 503", async () => {
    const response = await guardNotificationRemoteData(async () => {
      throw new Error("REMOTE_DATA_UNAVAILABLE");
    });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(503);
  });
});
