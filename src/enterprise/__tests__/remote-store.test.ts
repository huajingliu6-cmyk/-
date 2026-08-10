import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/persistence/remote-data-client", () => ({
  requestRemoteData: vi.fn(),
}));

import { requestRemoteData } from "@/persistence/remote-data-client";
import {
  isEnterpriseRevisionConflict,
  readRemoteEnterpriseCatalog,
  writeRemoteEnterpriseCatalog,
} from "@/enterprise/remote-store";

const mockedRequest = vi.mocked(requestRemoteData);
const emptyCatalog = {
  version: 1 as const,
  enterprises: [],
  joinRequests: [],
  auditEvents: [],
};

describe("remote enterprise store", () => {
  beforeEach(() => mockedRequest.mockReset());

  it("reads the catalog through the dedicated enterprise endpoint", async () => {
    mockedRequest.mockResolvedValue(
      Response.json({ revision: 3, value: emptyCatalog }),
    );

    await expect(readRemoteEnterpriseCatalog()).resolves.toEqual({
      revision: 3,
      value: emptyCatalog,
    });
    expect(mockedRequest).toHaveBeenCalledWith("/v1/enterprises/catalog");
  });

  it("treats a missing catalog as empty remote state", async () => {
    mockedRequest.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(readRemoteEnterpriseCatalog()).resolves.toBeNull();
  });

  it("maps revision conflicts for store retries", async () => {
    mockedRequest.mockResolvedValue(new Response(null, { status: 409 }));

    const error = await writeRemoteEnterpriseCatalog({
      expectedRevision: 2,
      value: emptyCatalog,
    }).catch((reason: unknown) => reason);

    expect(isEnterpriseRevisionConflict(error)).toBe(true);
    expect(mockedRequest).toHaveBeenCalledWith(
      "/v1/enterprises/catalog",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
