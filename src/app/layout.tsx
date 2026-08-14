import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { AppearanceProvider } from "@/shell/AppearanceProvider";
import { AuthSessionProvider } from "@/shell/AuthSessionProvider";
import { LoginPortalTransitionProvider } from "@/shell/LoginPortalTransitionProvider";
import "./globals.css";

/**
 * LAN/Docker builds often cannot reach fonts.googleapis.com (next/font/google).
 * Keep the same CSS variable names globals.css expects and point them at system fonts.
 */
const lanFontVars = {
  ["--font-geist-sans"]:
    'system-ui, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif',
  ["--font-geist-mono"]:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as CSSProperties;

export const metadata: Metadata = {
  title: { default: "Lumina Story", template: "%s | Lumina Story" },
  description: "Lumina Story — 从灵感、故事与分镜到成片的一站式 AI 创作平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full overflow-hidden antialiased"
      style={lanFontVars}
      // 忽略扩展注入到 <html> 的属性（如 Immersive Translate 的 data-immersive-translate-*）
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden" suppressHydrationWarning>
        <AppearanceProvider>
          <AuthSessionProvider>
            <LoginPortalTransitionProvider>
              {children}
            </LoginPortalTransitionProvider>
          </AuthSessionProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
