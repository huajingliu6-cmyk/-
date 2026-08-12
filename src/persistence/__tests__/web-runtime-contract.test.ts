import { describe, expect, it } from "vitest";
import {
  validateWebRuntimeContract,
  WebRuntimeContractError,
} from "@/persistence/web-runtime-contract";

describe("Web runtime contract", () => {
  it("does not constrain local development", () => {
    expect(() =>
      validateWebRuntimeContract({ NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("requires remote-only mode in production", () => {
    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
      }),
    ).toThrowError(WebRuntimeContractError);
  });

  it("requires the Go backend URL and internal token", () => {
    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
      }),
    ).toThrowError("GO_BACKEND_INTERNAL_URL is required");

    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
      }),
    ).toThrowError("INTERNAL_API_TOKEN is required");
  });

  it("rejects loopback backend addresses in production", () => {
    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://127.0.0.1:8080",
        INTERNAL_API_TOKEN: "test-token",
      }),
    ).toThrowError("not loopback");
  });

  it("rejects direct storage configuration in production Web", () => {
    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
        DATABASE_URL: "postgresql://web-must-not-connect",
      }),
    ).toThrowError("must not configure direct storage via DATABASE_URL");

    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
        APP_DATA_DIR: "/data",
      }),
    ).toThrowError("must not configure direct storage via APP_DATA_DIR");

    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
        BLOBSTORE_INTERNAL_URL: "http://blobstore:8090",
      }),
    ).toThrowError(
      "must not configure direct storage via BLOBSTORE_INTERNAL_URL",
    );

    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
        ALIYUN_OSS_ACCESS_KEY_SECRET: "must-not-reach-web",
      }),
    ).toThrowError(
      "must not configure direct storage via ALIYUN_OSS_ACCESS_KEY_SECRET",
    );
  });

  it("accepts an internal Go service address", () => {
    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
      }),
    ).not.toThrow();
  });

  it("allows LAN opt-in local voice library directory only", () => {
    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
        LOCAL_VOICE_LIBRARY_ALLOW_IN_REMOTE: "true",
        LOCAL_VOICE_LIBRARY_DIR: "/var/lib/infinite-canvas/local-voice-library",
      }),
    ).not.toThrow();

    expect(() =>
      validateWebRuntimeContract({
        NODE_ENV: "production",
        REMOTE_DATA_ONLY: "true",
        GO_BACKEND_INTERNAL_URL: "http://api:8080",
        INTERNAL_API_TOKEN: "test-token",
        LOCAL_VOICE_LIBRARY_DIR: "/var/lib/infinite-canvas/local-voice-library",
      }),
    ).toThrowError(
      "must not configure direct storage via LOCAL_VOICE_LIBRARY_DIR",
    );
  });
});
