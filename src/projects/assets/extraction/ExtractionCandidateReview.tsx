"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ConflictDecision,
  ExtractionConflict,
} from "@/projects/assets/extraction/types";

type Props = {
  projectId: string;
  apiRoot: string;
  assetsHref: string;
};

export function ExtractionCandidateReview({
  projectId,
  apiRoot,
  assetsHref,
}: Props) {
  const router = useRouter();
  const [conflicts, setConflicts] = useState<ExtractionConflict[]>([]);
  const [decisions, setDecisions] = useState<Record<string, ConflictDecision["choice"]>>(
    {},
  );
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`${apiRoot}/asset-extraction`, {
        credentials: "include",
      });
      if (!res.ok || cancelled) return;
      const payload = (await res.json()) as { conflicts?: ExtractionConflict[] };
      if (cancelled) return;
      const next = payload.conflicts ?? [];
      setConflicts(next);
      setDecisions(
        Object.fromEntries(
          next.map((conflict) => [
            conflict.identity,
            conflict.kind === "removed" ? "keep" : "use_ai",
          ]),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [apiRoot, projectId]);

  const items = useMemo(() => conflicts, [conflicts]);

  const applyBulk = (choice: ConflictDecision["choice"]) => {
    setDecisions((current) =>
      Object.fromEntries(
        items.map((conflict) => [
          conflict.identity,
          conflict.kind === "removed"
            ? choice === "use_ai"
              ? "remove"
              : "keep"
            : choice === "keep_manual"
              ? "keep_manual"
              : "use_ai",
        ]),
      ),
    );
  };

  const apply = async () => {
    setApplying(true);
    setError("");
    try {
      const res = await fetch(`${apiRoot}/asset-extraction/candidate/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisions: items.map((conflict) => ({
            identity: conflict.identity,
            kind: conflict.kind,
            choice: decisions[conflict.identity],
          })),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "无法应用重新提取结果");
      }
      router.push(assetsHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法应用重新提取结果");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="amw" data-testid="extraction-candidate-review">
      <h1>重新提取结果确认</h1>
      <p>旧资产仍保持生效。请逐项决定后再应用。</p>
      <div className="ead-overview__extract-actions">
        <button type="button" className="amw-btn" onClick={() => applyBulk("use_ai")}>
          全部采用新结果
        </button>
        <button
          type="button"
          className="amw-btn"
          onClick={() => applyBulk("keep_manual")}
        >
          全部保留人工修改
        </button>
      </div>
      <ul>
        {items.map((conflict) => (
          <li key={conflict.identity} data-testid="extraction-conflict-item">
            <strong>
              {conflict.assetType} · {conflict.name}
            </strong>
            <p>{conflict.kind === "removed" ? "新结果中已消失" : "候选结果已变化"}</p>
            {conflict.kind === "changed" ? (
              <div>
                <label>
                  <input
                    type="radio"
                    name={conflict.identity}
                    checked={decisions[conflict.identity] === "use_ai"}
                    onChange={() =>
                      setDecisions((current) => ({
                        ...current,
                        [conflict.identity]: "use_ai",
                      }))
                    }
                  />
                  采用新 AI 结果
                </label>
                <label>
                  <input
                    type="radio"
                    name={conflict.identity}
                    checked={decisions[conflict.identity] === "keep_manual"}
                    onChange={() =>
                      setDecisions((current) => ({
                        ...current,
                        [conflict.identity]: "keep_manual",
                      }))
                    }
                  />
                  保留当前人工修改
                </label>
              </div>
            ) : (
              <div>
                <label>
                  <input
                    type="radio"
                    name={conflict.identity}
                    checked={decisions[conflict.identity] === "keep"}
                    onChange={() =>
                      setDecisions((current) => ({
                        ...current,
                        [conflict.identity]: "keep",
                      }))
                    }
                  />
                  保留当前资产
                </label>
                <label>
                  <input
                    type="radio"
                    name={conflict.identity}
                    checked={decisions[conflict.identity] === "remove"}
                    onChange={() =>
                      setDecisions((current) => ({
                        ...current,
                        [conflict.identity]: "remove",
                      }))
                    }
                  />
                  按新结果移除
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        className="amw-btn amw-btn-primary"
        disabled={applying}
        data-testid="apply-extraction-candidate"
        onClick={() => void apply()}
      >
        {applying ? "应用中…" : "应用重新提取结果"}
      </button>
    </div>
  );
}
