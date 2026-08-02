"use client";

import { useCallback, useState } from "react";
import { prefersReducedMotion } from "@/shell/login-portal";

/** 顶部控件点击回弹 class 控制 */
export function useChipBounce() {
  const [bouncing, setBouncing] = useState(false);

  const trigger = useCallback(() => {
    if (prefersReducedMotion()) return;
    setBouncing(false);
    requestAnimationFrame(() => setBouncing(true));
  }, []);

  const onAnimationEnd = useCallback(() => {
    setBouncing(false);
  }, []);

  return {
    bounceClass: bouncing ? "is-bounce" : "",
    trigger,
    onAnimationEnd,
  };
}
