"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Palette, RotateCcw, X } from "lucide-react";

const STORAGE_KEY = "infinite-canvas-accent";
const DEFAULT_ACCENT = "#8b5cf6";
const PRESETS = ["#8b5cf6", "#2563eb", "#0891b2", "#059669", "#d97706", "#e11d48"];

type AppearanceContextValue = {
  accent: string;
  setAccent: (color: string) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function normalizeHex(value: string) {
  const trimmed = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

function applyAccent(color: string) {
  const normalized = normalizeHex(color) ?? DEFAULT_ACCENT;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const root = document.documentElement;
  root.style.setProperty("--ui-accent", normalized);
  root.style.setProperty("--ui-accent-rgb", `${red} ${green} ${blue}`);
  root.style.colorScheme = "dark";
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [accent, setAccentState] = useState(DEFAULT_ACCENT);

  useEffect(() => {
    const saved = normalizeHex(window.localStorage.getItem(STORAGE_KEY) ?? "");
    const initial = saved ?? DEFAULT_ACCENT;
    applyAccent(initial);
    const frame = window.requestAnimationFrame(() => setAccentState(initial));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setAccent = useCallback((color: string) => {
    const normalized = normalizeHex(color);
    if (!normalized) return;
    setAccentState(normalized);
    applyAccent(normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }, []);

  const value = useMemo(() => ({ accent, setAccent }), [accent, setAccent]);

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function AppearanceButton({ compact = false }: { compact?: boolean }) {
  const context = useContext(AppearanceContext);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const accent = context?.accent ?? DEFAULT_ACCENT;
  const setAccent = context?.setAccent ?? (() => undefined);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  if (!context) throw new Error("AppearanceButton must be used inside AppearanceProvider");

  return (
    <div className="appearance" ref={rootRef}>
      <button
        type="button"
        className={`appearance__trigger ${compact ? "is-compact" : ""}`}
        aria-label="界面颜色"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="界面颜色"
        onClick={() => setOpen((value) => !value)}
      >
        <Palette className="h-4 w-4" aria-hidden />
        {compact ? null : <span>颜色</span>}
        <span className="appearance__swatch" style={{ backgroundColor: accent }} aria-hidden />
      </button>

      {open ? (
        <div className="appearance__panel" role="dialog" aria-label="界面颜色设置">
          <div className="appearance__head">
            <div>
              <strong>界面颜色</strong>
              <span>选择全局强调色，设置会自动保存</span>
            </div>
            <button type="button" className="appearance__icon-btn" aria-label="关闭颜色设置" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="appearance__presets" aria-label="推荐颜色">
            {PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className="appearance__preset"
                style={{ backgroundColor: color }}
                aria-label={`使用颜色 ${color}`}
                aria-pressed={accent === color}
                onClick={() => setAccent(color)}
              >
                {accent === color ? <Check className="h-4 w-4" aria-hidden /> : null}
              </button>
            ))}
          </div>

          <label className="appearance__custom">
            <span>自定义颜色</span>
            <span className="appearance__custom-control">
              <input
                type="color"
                value={accent}
                aria-label="选择自定义颜色"
                onChange={(event) => setAccent(event.target.value)}
              />
              <code>{accent.toUpperCase()}</code>
            </span>
          </label>

          <button type="button" className="appearance__reset" onClick={() => setAccent(DEFAULT_ACCENT)}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            恢复默认颜色
          </button>
        </div>
      ) : null}
    </div>
  );
}
