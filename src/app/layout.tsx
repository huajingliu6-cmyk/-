import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LoginPortalTransitionProvider } from "@/shell/LoginPortalTransitionProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI 视频工作流",
  description: "基于 Next.js + React Flow 的 AI 视频工作流编辑器",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased`}
      // 忽略扩展注入到 <html> 的属性（如 Immersive Translate 的 data-immersive-translate-*）
      suppressHydrationWarning
    >
      <body className="h-full overflow-hidden" suppressHydrationWarning>
        <LoginPortalTransitionProvider>{children}</LoginPortalTransitionProvider>
      </body>
    </html>
  );
}
