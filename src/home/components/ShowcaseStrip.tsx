"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { HOME_SHOWCASE_PLACEHOLDERS } from "@/home/placeholder-data";
import type { ShowcaseItem } from "@/home/types";

function ShowcaseCard({
  item,
  allowHoverPreview,
}: {
  item: ShowcaseItem;
  allowHoverPreview: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  const canPreview = Boolean(
    allowHoverPreview && item.previewVideoUrl && hovering,
  );

  return (
    <article
      className="home-card relative shrink-0 overflow-hidden bg-[#12101c]"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      tabIndex={0}
      aria-label={`${item.title}，${item.kind}，${item.status}`}
    >
      <div className="absolute inset-0" style={{ background: item.gradient }} />
      {item.coverUrl ? (
        // 仅本地/同源封面；不引用互联网图片
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : null}
      {canPreview && item.previewVideoUrl ? (
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={item.previewVideoUrl}
          muted
          loop
          playsInline
          autoPlay
        />
      ) : null}

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

      <div
        className={`absolute inset-0 flex items-center justify-center transition ${
          hovering ? "opacity-100" : "opacity-0"
        }`}
      >
        <span
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"
          aria-hidden
        >
          <Play className="h-4 w-4 fill-current" />
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-2.5 text-left">
        <div className="truncate text-[12px] font-medium text-white">
          {item.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/65">
          <span>{item.kind}</span>
          <span aria-hidden>·</span>
          <span>{item.status}</span>
        </div>
      </div>
    </article>
  );
}

export function ShowcaseStrip() {
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const items = HOME_SHOWCASE_PLACEHOLDERS;
  // 复制一份用于无缝横向循环（仅桌面 CSS marquee）
  const loopItems = [...items, ...items];

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onVisibility = () =>
      setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    const id = requestAnimationFrame(onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(id);
    };
  }, []);

  const trackPaused = paused || !pageVisible;

  return (
    <section
      id="home-showcase"
      className={`relative z-10 pb-10 pt-2 ${ready ? "home-rise is-ready delay-4" : "home-rise"}`}
      aria-label="作品展示"
    >
      <div className="mb-4 px-5 text-left sm:px-8 lg:px-10">
        <h2 className="text-sm font-medium tracking-wide text-white/55">
          作品展示
        </h2>
      </div>

      {/* 移动端：手动横滑 + snap */}
      <div className="flex gap-5 overflow-x-auto px-5 pb-2 snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <div key={item.id} className="snap-start">
            <ShowcaseCard item={item} allowHoverPreview={false} />
          </div>
        ))}
      </div>

      {/* 桌面端：缓慢横向移动，悬停/不可见时暂停 */}
      <div
        className="relative hidden overflow-hidden md:block"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div
          className={`home-showcase-track px-8 ${trackPaused ? "is-paused" : ""}`}
        >
          {loopItems.map((item, index) => (
            <ShowcaseCard
              key={`${item.id}-${index}`}
              item={item}
              allowHoverPreview
            />
          ))}
        </div>
      </div>
    </section>
  );
}
