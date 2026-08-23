"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  consumeLoginPortalFlag,
  prefersReducedMotion,
  writeLoginPortalFlag,
} from "@/shell/login-portal";
import { LoginPortalOverlay } from "@/shell/LoginPortalOverlay";
import { APP_POST_LOGIN_PATH } from "@/shell/nav";
import "@/shell/shell.css";

type PortalPhase = "idle" | "exit" | "enter";

type PlayOptions = {
  target: string;
  /** 登录成功后、导航前调用（延迟更新身份 UI，避免退出阶段闪烁） */
  onBeforeNavigate?: () => void;
};

type PortalContextValue = {
  playLoginSuccess: (opts: PlayOptions) => Promise<void>;
  phase: PortalPhase;
};

const PortalContext = createContext<PortalContextValue | null>(null);

export function useLoginPortalTransition(): PortalContextValue {
  const ctx = useContext(PortalContext);
  if (!ctx) {
    throw new Error(
      "useLoginPortalTransition must be used within LoginPortalTransitionProvider",
    );
  }
  return ctx;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function setHtmlPhase(phase: PortalPhase) {
  const root = document.documentElement;
  root.classList.remove("login-portal-exit", "login-portal-enter", "login-portal-lock");
  if (phase === "exit") {
    root.classList.add("login-portal-exit", "login-portal-lock");
  } else if (phase === "enter") {
    root.classList.add("login-portal-enter", "login-portal-lock");
  }
}

export function LoginPortalTransitionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<PortalPhase>("idle");
  const playingRef = useRef(false);
  const enterStartedRef = useRef(false);

  const runEnter = useCallback(async () => {
    if (enterStartedRef.current) return;
    enterStartedRef.current = true;
    setPhase("enter");
    setHtmlPhase("enter");
    await wait(prefersReducedMotion() ? 200 : 560);
    setPhase("idle");
    setHtmlPhase("idle");
    playingRef.current = false;
    enterStartedRef.current = false;
  }, []);

  // 跨路由：目标页挂载后消费一次性标记并播放进入
  useEffect(() => {
    const payload = consumeLoginPortalFlag();
    if (!payload) return;
    void runEnter();
  }, [pathname, runEnter]);

  useEffect(() => {
    return () => {
      setHtmlPhase("idle");
      document.documentElement.classList.remove("login-portal-lock");
    };
  }, []);

  const playLoginSuccess = useCallback(
    async ({ target, onBeforeNavigate }: PlayOptions) => {
      if (playingRef.current) return;
      playingRef.current = true;

      const safeTarget =
        target.startsWith("/") && !target.startsWith("//")
          ? target
          : APP_POST_LOGIN_PATH;

      if (prefersReducedMotion()) {
        writeLoginPortalFlag(safeTarget);
        setPhase("exit");
        setHtmlPhase("exit");
        await wait(180);
        onBeforeNavigate?.();
        if (pathname !== safeTarget.split("#")[0]) {
          router.replace(safeTarget);
          router.refresh();
          // 进入阶段由目标页 effect 触发
          return;
        }
        consumeLoginPortalFlag();
        await runEnter();
        return;
      }

      writeLoginPortalFlag(safeTarget);
      setPhase("exit");
      setHtmlPhase("exit");
      // 阶段二：钻入通道（与 overlay 同步）
      await wait(560);

      onBeforeNavigate?.();
      const pathOnly = safeTarget.split("#")[0] || "/";
      if (pathname !== pathOnly) {
        router.replace(safeTarget);
        router.refresh();
        // 进入阶段：目标页挂载后 consume + runEnter
        // 兜底：若同页未触发，稍后尝试
        window.setTimeout(() => {
          if (playingRef.current && !enterStartedRef.current) {
            consumeLoginPortalFlag();
            void runEnter();
          }
        }, 1200);
        return;
      }

      consumeLoginPortalFlag();
      await runEnter();
    },
    [pathname, router, runEnter],
  );

  const value = useMemo(
    () => ({ playLoginSuccess, phase }),
    [playLoginSuccess, phase],
  );

  return (
    <PortalContext.Provider value={value}>
      <div className="shell-app-root h-full min-h-full">{children}</div>
      <LoginPortalOverlay phase={phase} />
    </PortalContext.Provider>
  );
}
