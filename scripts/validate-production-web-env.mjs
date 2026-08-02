const directStorageVariables = [
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
];

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.env.NODE_ENV === "production") {
  if (process.env.REMOTE_DATA_ONLY !== "true") {
    throw new Error("production Web requires REMOTE_DATA_ONLY=true");
  }
  for (const name of directStorageVariables) {
    if ((process.env[name] ?? "").trim()) {
      throw new Error(`production Web must not configure direct storage via ${name}`);
    }
  }
  const backendUrl = new URL(required("GO_BACKEND_INTERNAL_URL"));
  required("INTERNAL_API_TOKEN");
  if (backendUrl.protocol !== "http:" && backendUrl.protocol !== "https:") {
    throw new Error("GO_BACKEND_INTERNAL_URL must use HTTP or HTTPS");
  }
  const hostname = backendUrl.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("production Web must reach Go through an internal service address, not loopback");
  }
}

console.log("Production Web environment contract passed.");