"use client";

import { useEffect, useState } from "react";
import { HeroCta } from "@/home/components/HeroCta";

const CAPABILITY_TAGS = [
  "脚本导入",
  "分镜规划",
  "视频生成",
  "素材管理",
  "团队协作",
] as const;

export function HeroSection() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rise = (...parts: string[]) =>
    ["home-rise", ready ? "is-ready" : "", ...parts].filter(Boolean).join(" ");

  return (
    <section className="relative z-10 flex min-h-[calc(100svh-var(--home-header-h))] flex-col items-center justify-center px-5 pb-8 pt-10 text-center sm:px-8">
      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center">
        <h1
          className={`${rise()} text-[38px] font-semibold leading-[1.15] tracking-tight text-white sm:text-5xl lg:text-[68px]`}
        >
          从灵感到成片，一站式完成{" "}
          <span className="home-gradient-text">AI 视频创作</span>
        </h1>

        <p
          className={`${rise("delay-1")} mt-5 max-w-[640px] text-[15px] leading-relaxed text-white/65 sm:text-base lg:text-lg`}
        >
          脚本导入、分镜规划、素材管理、视频生成与团队协作，全部在一个工作台完成。
        </p>

        <div className={`${rise("delay-2")} mt-[34px] flex w-full justify-center`}>
          <HeroCta />
        </div>

        <p
          className={`${rise("delay-3")} mt-6 text-[12px] tracking-[0.06em] text-white/40 sm:text-[13px]`}
        >
          {CAPABILITY_TAGS.join(" · ")}
        </p>
      </div>
    </section>
  );
}
