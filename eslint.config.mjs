import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/workflow/components/AssetThumb.tsx"],
    rules: {
      // 画布缩略图需用原生 img，避免 next/image 在节点选中时闪烁
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
