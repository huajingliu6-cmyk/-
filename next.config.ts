import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["./data/**/*"],
  },
  typescript: {
    ignoreBuildErrors: false,
    tsconfigPath: "tsconfig.build.json",
  },
  images: {
    localPatterns: [{ pathname: "/api/assets/**" }],
  },
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
      "**/.next/**",
      "**/coverage/**",
      "**/*.tmp",
      "**/*.tmp.*",
    ];
    config.watchOptions = {
      ...config.watchOptions,
      ignored,
    };
    return config;
  },
};

export default nextConfig;
