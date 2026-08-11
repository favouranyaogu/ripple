"use client";

import { useEffect, useState } from "react";

interface XUsageData {
  spentToday: number;
  budget: number;
  remaining: number;
  projectedCostPerScan: number;
}

/**
 * Small live badge showing today's X API spend against the daily budget.
 * Turns into a "daily budget reached" state when a single scan would no
 * longer fit in the remaining budget.
 */
export default function XBudgetBadge({ className = "" }: { className?: string }) {
  const [data, setData] = useState<XUsageData | null>(null);

  useEffect(() => {
    fetch("/api/x-usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((d: XUsageData | null) => {
        if (
          d &&
          typeof d.spentToday === "number" &&
          typeof d.budget === "number" &&
          typeof d.remaining === "number" &&
          typeof d.projectedCostPerScan === "number"
        ) {
          setData(d);
        }
      })
      .catch(() => {
        // Endpoint unavailable — hide the badge rather than breaking the page.
      });
  }, []);

  if (!data) return null;

  const exhausted = data.remaining < data.projectedCostPerScan;
  const pct = data.budget > 0 ? Math.min(100, (data.spentToday / data.budget) * 100) : 0;

  return (
    <div
      className={`inline-flex items-center gap-3 rounded-xl border bg-white px-3.5 py-2.5 shadow-card ${
        exhausted ? "border-red-200" : "border-zinc-200"
      } ${className}`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">X API</span>
      <span className="min-w-0">
        {exhausted ? (
          <span className="font-mono text-xs text-red-600 font-medium">daily budget reached</span>
        ) : (
          <>
            <span className="flex items-baseline gap-1 font-mono text-xs text-foreground">
              ${data.spentToday.toFixed(2)}
              <span className="text-subtle">/ ${data.budget.toFixed(2)}</span>
              <span className="text-subtle">today</span>
            </span>
            <span className="block h-1 w-24 mt-1 rounded-full bg-zinc-100 overflow-hidden">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
          </>
        )}
      </span>
    </div>
  );
}
