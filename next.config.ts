import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 本地开发素材预览（/api/assets/[id]）
    localPatterns: [{ pathname: "/api/assets/**" }],
  },
  // 忽略 data/：自动保存写盘时不应触发 webpack HMR（否则白屏闪烁 / 保存循环）
  webpack: (config, { dev }) => {
    if (!dev) return config;
    const prev = config.watchOptions?.ignored;
    const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
    const ignored = [
      ...prevList.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
      "**/.git/**",
      "**/node_modules/**",
      "**/data/**",
    ];
    config.watchOptions = {
      ...config.watchOptions,
      ignored,
    };
    return config;
  },
};

export default nextConfig;
