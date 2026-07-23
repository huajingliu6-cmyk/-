import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 本地开发素材预览（/api/assets/[id]）
    localPatterns: [{ pathname: "/api/assets/**" }],
  },
};

export default nextConfig;
