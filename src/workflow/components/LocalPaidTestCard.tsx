"use client";

import { useEffect, useState } from "react";

type PublicBits = {
  localPaidTestModeEnabled: boolean;
  isDevelopment: boolean;
  tokenConfigured: boolean;
  priceConfirmed: boolean;
  maxCostConfigured: boolean;
  maxCostCny: number | null;
  allowlistConfigured: boolean;
  costNotice?: string;
  phaseNotice: string;
  realSubmitEnabled: false;
};

type GuardBits = {
  state: string;
  armedAt: string | null;
  updatedAt: string;
  lastErrorCode: string | null;
};

type Check = { key: string; status: string; message: string };

type PanelData = {
  visible: boolean;
  publicConfig: PublicBits;
  confirmationPhraseHint: string | null;
  guard: GuardBits | null;
  checks: Check[];
  allowlistWarning: string | null;
};

/**
 * 本机一次性付费测试卡片。
 * 仅 development + 模式开启 + 管理员可见。
 * 「确认一次付费测试」本阶段始终禁用。
 */
export function LocalPaidTestCard() {
  const [data, setData] = useState<PanelData | null>(null);
  const [token, setToken] = useState("");
  const [phrase, setPhrase] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/local-paid-test");
        if (!res.ok) {
          if (!cancelled) {
            setData({
              visible: false,
              publicConfig: {
                localPaidTestModeEnabled: false,
                isDevelopment: false,
                tokenConfigured: false,
                priceConfirmed: false,
                maxCostConfigured: false,
                maxCostCny: null,
                allowlistConfigured: false,
                phaseNotice: "",
                realSubmitEnabled: false,
              },
              confirmationPhraseHint: null,
              guard: null,
              checks: [],
              allowlistWarning: null,
            });
          }
          return;
        }
        const payload = (await res.json()) as {
          visible: boolean;
          publicConfig: PublicBits;
          confirmationPhraseHint: string | null;
          guard?: GuardBits;
          readiness?: {
            checks: Check[];
            allowlistEmptyWarning: string | null;
          };
        };
        if (!cancelled) {
          setData({
            visible: Boolean(payload.visible),
            publicConfig: payload.publicConfig,
            confirmationPhraseHint: payload.confirmationPhraseHint,
            guard: payload.guard ?? null,
            checks: payload.readiness?.checks ?? [],
            allowlistWarning: payload.readiness?.allowlistEmptyWarning ?? null,
          });
        }
      } catch {
        if (!cancelled) {
          setData({
            visible: false,
            publicConfig: {
              localPaidTestModeEnabled: false,
              isDevelopment: false,
              tokenConfigured: false,
              priceConfirmed: false,
              maxCostConfigured: false,
              maxCostCny: null,
              allowlistConfigured: false,
              phaseNotice: "",
              realSubmitEnabled: false,
            },
            confirmationPhraseHint: null,
            guard: null,
            checks: [],
            allowlistWarning: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (!data?.visible || !data.publicConfig) return null;

  const {
    publicConfig,
    guard,
    checks,
    allowlistWarning,
    confirmationPhraseHint,
  } = data;
  const blockers = checks.filter((c) => c.status === "fail");

  async function onArm() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/local-paid-test/arm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          confirmationPhrase: phrase || confirmationPhraseHint,
        }),
      });
      const payload = (await res.json()) as {
        message?: string;
        notice?: string;
      };
      setToken("");
      setPhrase("");
      if (!res.ok) {
        setNotice(payload.message ?? "武装失败");
      } else {
        setNotice(payload.notice ?? "已武装");
        setReloadKey((k) => k + 1);
      }
    } catch {
      setNotice("武装请求失败");
      setToken("");
      setPhrase("");
    } finally {
      setBusy(false);
    }
  }

  async function onDryRun() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/local-paid-test/dry-run", {
        method: "POST",
      });
      const payload = (await res.json()) as {
        notice?: string;
        message?: string;
      };
      setNotice(payload.notice ?? payload.message ?? "Dry Run 完成");
    } catch {
      setNotice("Dry Run 失败");
    } finally {
      setBusy(false);
    }
  }

  async function onSimulation() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/local-paid-test/simulation", {
        method: "POST",
      });
      const payload = (await res.json()) as {
        notice?: string;
        message?: string;
      };
      if (!res.ok) {
        setNotice(payload.message ?? "Simulation 失败");
      } else {
        setNotice(
          payload.notice ??
            "Simulation 完成（simulation=true，非真实 Provider 成功）",
        );
        setReloadKey((k) => k + 1);
      }
    } catch {
      setNotice("Simulation 失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="pointer-events-auto w-[min(420px,calc(100vw-2rem))] rounded-xl border border-amber-500/40 bg-zinc-950/95 p-4 text-zinc-100 shadow-xl"
      aria-label="本机一次性付费测试"
    >
      <h2 className="text-sm font-semibold text-amber-300">
        本机一次性付费测试闸门
      </h2>
      <p className="mt-1 text-xs text-zinc-400">{publicConfig.phaseNotice}</p>
      <p className="mt-1 text-xs text-zinc-500">{publicConfig.costNotice}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">Guard</dt>
        <dd>{guard?.state ?? "—"}</dd>
        <dt className="text-zinc-500">Token</dt>
        <dd>{publicConfig.tokenConfigured ? "是" : "否"}</dd>
        <dt className="text-zinc-500">当日价格确认</dt>
        <dd>{publicConfig.priceConfirmed ? "是" : "否"}</dd>
        <dt className="text-zinc-500">费用上限</dt>
        <dd>
          {publicConfig.maxCostConfigured
            ? `${publicConfig.maxCostCny} 元`
            : "未配置"}
        </dd>
        <dt className="text-zinc-500">规格</dt>
        <dd>T2V · 720P · 16:9 · 2s · 无参考</dd>
        <dt className="text-zinc-500">allowlist</dt>
        <dd>
          {publicConfig.allowlistConfigured ? "已配置" : "空（转存将阻止）"}
        </dd>
      </dl>

      {allowlistWarning ? (
        <p className="mt-2 text-xs text-amber-200/90">{allowlistWarning}</p>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="mt-2 max-h-24 list-disc overflow-auto pl-4 text-xs text-red-300">
          {blockers.map((b) => (
            <li key={b.key}>{b.message}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 space-y-2">
        <input
          type="password"
          autoComplete="off"
          placeholder="测试 Token（提交后清空）"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <input
          type="text"
          autoComplete="off"
          placeholder={confirmationPhraseHint ?? "确认短语"}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onArm()}
          className="rounded bg-amber-600/90 px-2.5 py-1 text-xs font-medium text-black disabled:opacity-50"
        >
          Arm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDryRun()}
          className="rounded border border-zinc-600 px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Dry Run
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSimulation()}
          className="rounded border border-zinc-600 px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Simulation
        </button>
        <button
          type="button"
          disabled
          title="本阶段禁用真实付费提交"
          className="cursor-not-allowed rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-500"
        >
          确认一次付费测试
        </button>
      </div>

      {notice ? (
        <p className="mt-2 text-xs text-emerald-300/90" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
