"use client";

import { useEffect, useRef, useState } from "react";
import { safeRandomUUID } from "@/lib/safe-random-id";
import { LOCAL_PAID_TEST_SUBMIT_WARNING } from "@/video-generation/local-paid-test/constants";

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
  realSubmitPathWired?: boolean;
  realSubmitEnabled: boolean;
};

type GuardBits = {
  state: string;
  armedAt: string | null;
  updatedAt: string;
  lastErrorCode: string | null;
  generationId?: string | null;
};

type Check = { key: string; status: string; message: string };

type PanelData = {
  visible: boolean;
  publicConfig: PublicBits;
  confirmationPhraseHint: string | null;
  guard: GuardBits | null;
  checks: Check[];
  allowlistWarning: string | null;
  readyForOneShotLocalTest: boolean;
};

/**
 * 本机一次性付费测试卡片。
 * Arm nonce 仅保存在 React 内存；刷新后丢失，需重新 Arm。
 * 「确认一次付费测试」仅在 request readiness 通过且持有 nonce 时可点。
 */
export function LocalPaidTestCard() {
  const [data, setData] = useState<PanelData | null>(null);
  const [token, setToken] = useState("");
  const [phrase, setPhrase] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** 仅内存：不写 LocalStorage / SessionStorage / URL */
  const [armNonce, setArmNonce] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [shotNodeId, setShotNodeId] = useState("");
  /** 提交瞬间锁定：与 busy 同步，避免连点；不依赖下一帧才禁用 */
  const [submitLocked, setSubmitLocked] = useState(false);
  /** 仅事件处理器内同步防重入；不在 render 读取 */
  const submitInFlightRef = useRef(false);

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
              readyForOneShotLocalTest: false,
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
            readyForOneShotLocalTest?: boolean;
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
            readyForOneShotLocalTest: Boolean(
              payload.readiness?.readyForOneShotLocalTest,
            ),
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
            readyForOneShotLocalTest: false,
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
    readyForOneShotLocalTest,
  } = data;
  const blockers = checks.filter((c) => c.status === "fail");
  const guardState = guard?.state ?? "unarmed";
  const isUnknown = guardState === "unknownOutcome";
  const isTransferPending = guardState === "transferPending";
  const isSubmitting =
    busy ||
    submitLocked ||
    guardState === "submitting" ||
    guardState === "providerAccepted";

  const canSubmit =
    readyForOneShotLocalTest &&
    Boolean(armNonce) &&
    guardState === "armed" &&
    !isSubmitting &&
    !isUnknown &&
    Boolean(projectId.trim()) &&
    Boolean(shotNodeId.trim()) &&
    Boolean(token.trim()) &&
    Boolean(phrase.trim());

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
        armNonce?: string;
      };
      setToken("");
      setPhrase("");
      if (!res.ok) {
        setArmNonce(null);
        setNotice(payload.message ?? "武装失败");
      } else {
        setArmNonce(payload.armNonce ?? null);
        setNotice(
          payload.notice ??
            "已武装（提交凭证仅保存在本页内存，刷新后需重新武装）",
        );
        setReloadKey((k) => k + 1);
      }
    } catch {
      setNotice("武装请求失败");
      setToken("");
      setPhrase("");
      setArmNonce(null);
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

  async function onSubmitPaid() {
    if (submitInFlightRef.current || submitLocked || busy || !armNonce) return;
    if (
      !readyForOneShotLocalTest ||
      guardState !== "armed" ||
      isUnknown ||
      !projectId.trim() ||
      !shotNodeId.trim() ||
      !token.trim() ||
      !phrase.trim()
    ) {
      return;
    }
    submitInFlightRef.current = true;
    setSubmitLocked(true);
    setBusy(true);
    setNotice(null);
    const nonceSnapshot = armNonce;
    const tokenSnapshot = token;
    const phraseSnapshot = phrase;
    // 立即清空敏感输入，避免重复提交
    setToken("");
    setPhrase("");
    setArmNonce(null);
    try {
      const res = await fetch("/api/local-paid-test/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId.trim(),
          shotNodeId: shotNodeId.trim(),
          confirmPaidGeneration: true,
          token: tokenSnapshot,
          confirmationPhrase: phraseSnapshot,
          armNonce: nonceSnapshot,
          idempotencyKey: `local-one-shot-${safeRandomUUID()}`,
        }),
      });
      const payload = (await res.json()) as {
        message?: string;
        notice?: string;
        code?: string;
      };
      if (!res.ok) {
        setNotice(payload.message ?? "提交失败");
      } else {
        setNotice(payload.notice ?? "已提交一次性测试任务");
      }
      setReloadKey((k) => k + 1);
    } catch {
      setNotice("提交请求失败");
    } finally {
      submitInFlightRef.current = false;
      setSubmitLocked(false);
      setBusy(false);
    }
  }

  async function onRetryTransfer() {
    if (!guard?.generationId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/generations/${encodeURIComponent(guard.generationId)}/transfer`,
        { method: "POST" },
      );
      const payload = (await res.json()) as { message?: string };
      if (!res.ok) {
        setNotice(payload.message ?? "转存重试失败");
      } else {
        setNotice("转存重试完成");
      }
      setReloadKey((k) => k + 1);
    } catch {
      setNotice("转存重试失败");
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
        <dt className="text-zinc-500">内存凭证</dt>
        <dd>{armNonce ? "已持有（刷新会丢失）" : "无（需重新 Arm）"}</dd>
      </dl>

      {allowlistWarning ? (
        <p className="mt-2 text-xs text-amber-200/90">{allowlistWarning}</p>
      ) : null}

      {isUnknown ? (
        <p className="mt-2 text-xs font-medium text-red-300" role="alert">
          提交结果无法确认，为避免重复计费，一次性测试已锁定。请勿再次提交。
        </p>
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
        <input
          type="text"
          autoComplete="off"
          placeholder="projectId（提交时用）"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        />
        <input
          type="text"
          autoComplete="off"
          placeholder="shotNodeId（提交时用）"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          value={shotNodeId}
          onChange={(e) => setShotNodeId(e.target.value)}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || isUnknown}
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
          disabled={!canSubmit}
          title={
            canSubmit
              ? LOCAL_PAID_TEST_SUBMIT_WARNING
              : "需通过 readiness、完成 Arm，并填写 Token / 确认短语"
          }
          onClick={() => void onSubmitPaid()}
          className="rounded bg-red-700/90 px-2.5 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          确认一次付费测试
        </button>
        {isTransferPending ? (
          <button
            type="button"
            disabled={busy || !guard?.generationId}
            onClick={() => void onRetryTransfer()}
            className="rounded border border-amber-500/60 px-2.5 py-1 text-xs disabled:opacity-50"
          >
            重试转存
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-amber-200/80">
        {LOCAL_PAID_TEST_SUBMIT_WARNING}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        本机一次性模式禁止重新生成（retryGeneration）；转存失败时仅允许重试转存。
      </p>

      {notice ? (
        <p className="mt-2 text-xs text-emerald-300/90" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
