"use client";

import { useEffect, useState } from "react";
import { GuangheSprite } from "@/home/components/GuangheSprite";
import { HeroCta } from "@/home/components/HeroCta";

export function HeroSection() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const rise = (...parts: string[]) =>
    ["home-rise", ready ? "is-ready" : "", ...parts].filter(Boolean).join(" ");

  return (
    <section className="home-hero relative z-10 flex min-h-[calc(100svh-var(--home-header-h))] flex-col items-center justify-center px-5 pb-8 pt-8 text-center sm:px-8">
      <div className="mx-auto flex w-full max-w-[940px] flex-col items-center">
        <div className={rise("home-guanghe-wrap")}>
          <GuangheSprite />
          <div className="home-guanghe-name">
            <strong>Lumina Story</strong>
            <span>你的 AI 故事创作伙伴</span>
          </div>
        </div>

        <h1
          className={`${rise("delay-1")} home-hero-title text-[38px] font-semibold leading-[1.12] tracking-tight text-white sm:text-5xl lg:text-[66px]`}
        >
          灵感，直接成片
        </h1>

        <p
          className={`${rise("delay-2")} home-hero-copy mt-4 max-w-[560px] text-[15px] leading-relaxed text-white/62 sm:text-base lg:text-lg`}
        >
          从故事、分镜到视频，一站完成。
        </p>

        <div className={`${rise("delay-3")} mt-7 flex w-full justify-center`}>
          <HeroCta />
        </div>
      </div>
    </section>
  );
}
