import type { Metadata } from "next";
import { HomePage } from "@/home/components/HomePage";

export const metadata: Metadata = {
  title: "智能视频工作台",
  description: "从灵感到成片，一站式完成 AI 视频创作",
};

export default function Home() {
  return <HomePage />;
}
