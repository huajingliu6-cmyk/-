"use client";

import { useEffect, useRef } from "react";

/**
 * CSS 液态渐变背景 + 桌面端轻微鼠标视差（rAF 节流，不驱动 React 重渲染）
 */
export function AnimatedHeroBackground() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduceMotion || isCoarse) return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let running = true;

    const tick = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      layer.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`;
      if (
        running &&
        (Math.abs(targetX - currentX) > 0.05 ||
          Math.abs(targetY - currentY) > 0.05)
      ) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };

    const onMove = (event: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      const nx = (event.clientX / innerWidth - 0.5) * 2;
      const ny = (event.clientY / innerHeight - 0.5) * 2;
      // 最大位移不超过 10px
      targetX = nx * 10;
      targetY = ny * 10;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      running = false;
      window.removeEventListener("mousemove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="home-bg" aria-hidden>
      <div ref={layerRef} className="home-bg__parallax">
        <div className="home-bg__blob home-bg__blob--a" />
        <div className="home-bg__blob home-bg__blob--b" />
        <div className="home-bg__blob home-bg__blob--c" />
        <div className="home-bg__blob home-bg__blob--d" />
        <div className="home-bg__ribbon home-bg__ribbon--a" />
        <div className="home-bg__ribbon home-bg__ribbon--b" />
      </div>
      <div className="home-bg__vignette" />
      <div className="home-bg__grain" />
    </div>
  );
}
