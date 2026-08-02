import { getGenerationApiConfig } from "../src/auth/api-config.ts";
import {
  buildSd2CreateUrl,
  detectHttpVideoDialect,
} from "../src/video-generation/provider/http-video-dialect.ts";

async function main() {
  const shot = await getGenerationApiConfig("video-shot");
  const url = buildSd2CreateUrl(shot.apiUrl || "");
  const key = (shot.apiKey || "").trim().replace(/^Bearer\s+/i, "");
  console.log(
    JSON.stringify(
      {
        apiUrl: shot.apiUrl,
        createUrl: url,
        dialect: detectHttpVideoDialect(shot.apiUrl || ""),
        model: shot.model,
        hasKey: Boolean(key),
        keyPrefix: key ? `${key.slice(0, 6)}...` : null,
        secretUnavailable: shot.secretUnavailable,
      },
      null,
      2,
    ),
  );

  if (!key) {
    console.error("NO_KEY");
    process.exit(2);
  }

  const body = {
    model: shot.model || "doubao-seedance-2.0",
    duration: 5,
    resolution: "720p",
    content: [
      {
        type: "text",
        text: "一只白猫在窗台上晒太阳，电影感镜头，测试连通性",
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Idempotency-Key": `smoke-text-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("STATUS", res.status);
  console.log("BODY", text.slice(0, 1200));
}

main().catch((e) => {
  console.error("THROW", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
