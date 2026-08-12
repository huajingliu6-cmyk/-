import "server-only";

type RuntimeEnvironment = Record<string, string | undefined>;

const DIRECT_STORAGE_ENVIRONMENT_VARIABLES = [
  "DATABASE_URL",
  "SSDB_ADDRESS",
  "PERSISTENCE_DRIVER",
  "FILE_STORAGE_DRIVER",
  "LOCAL_STORAGE_ROOT",
  "APP_DATA_DIR",
  "DATA_ROOT",
  "LOCAL_VOICE_LIBRARY_DIR",
  "MOCK_VIDEO_FILE",
  "ALLOW_FILE_DRIVER_IN_PRODUCTION",
  "BLOB_STORAGE_DRIVER",
  "BLOBSTORE_INTERNAL_URL",
  "BLOBSTORE_INTERNAL_TOKEN",
  "ALIYUN_OSS_ENDPOINT",
  "ALIYUN_OSS_REGION",
  "ALIYUN_OSS_BUCKET",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
] as const;

export class WebRuntimeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebRuntimeContractError";
  }
}

function required(environment: RuntimeEnvironment, name: string): string {
  const value = (environment[name] ?? "").trim();
  if (!value) {
    throw new WebRuntimeContractError(`${name} is required`);
  }
  return value;
}

function isTruthy(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function assertInternalBackendUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WebRuntimeContractError(
      "GO_BACKEND_INTERNAL_URL must be an absolute HTTP(S) URL",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebRuntimeContractError(
      "GO_BACKEND_INTERNAL_URL must use HTTP or HTTPS",
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    throw new WebRuntimeContractError(
      "production Web must reach Go through an internal service address, not loopback",
    );
  }
}

export function validateWebRuntimeContract(
  environment: RuntimeEnvironment = process.env,
): void {
  if (environment.NODE_ENV !== "production") return;

  if (environment.REMOTE_DATA_ONLY !== "true") {
    throw new WebRuntimeContractError(
      "production Web requires REMOTE_DATA_ONLY=true",
    );
  }

  const allowLanVoiceLibrary = isTruthy(
    environment.LOCAL_VOICE_LIBRARY_ALLOW_IN_REMOTE,
  );

  for (const name of DIRECT_STORAGE_ENVIRONMENT_VARIABLES) {
    if (name === "LOCAL_VOICE_LIBRARY_DIR" && allowLanVoiceLibrary) {
      continue;
    }
    if ((environment[name] ?? "").trim()) {
      throw new WebRuntimeContractError(
        `production Web must not configure direct storage via ${name}`,
      );
    }
  }

  if (
    allowLanVoiceLibrary &&
    !(environment.LOCAL_VOICE_LIBRARY_DIR ?? "").trim()
  ) {
    throw new WebRuntimeContractError(
      "LOCAL_VOICE_LIBRARY_ALLOW_IN_REMOTE requires LOCAL_VOICE_LIBRARY_DIR",
    );
  }

  const backendUrl = required(environment, "GO_BACKEND_INTERNAL_URL");
  required(environment, "INTERNAL_API_TOKEN");
  assertInternalBackendUrl(backendUrl);
}