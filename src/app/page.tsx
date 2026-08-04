import type { Metadata } from "next";
import { HomePage } from "@/home/components/HomePage";

export const metadata: Metadata = {
  title: { absolute: "Lumina Story" },
  description: "Lumina Story，让灵感从故事与分镜直接成为影片",
};

export default function Home() {
  return <HomePage />;
}
