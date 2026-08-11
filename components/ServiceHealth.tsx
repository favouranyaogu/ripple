"use client";

import { useEffect, useState } from "react";

interface Service {
  id: string;
  name: string;
  status: "ok" | "down" | "pending" | "unconfigured";
  detail: string;
}

interface HealthData {
  services: Service[];
  checkedAt: string;
}

const STATUS_META: Record<Service["status"], { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-positive", text: "text-positive", label: "ok" },
  down: { dot: "bg-negative", text: "text-negative", label: "down" },
  pending: { dot: "bg-uncertain animate-pulse", text: "text-uncertain", label: "pending" },
  unconfigured: { dot: "bg-zinc-300", text: "text-subtle", label: "unconfigured" },
};

/**
 * Live per-service health list. Fetches /api/health on mount and every 60s,
 * so a Gemini outage (for example) is visible before you run a scan.
 */
export default function ServiceHealth() {
  const [data, setData] = useState<HealthData | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/health")
        .then((res) => (res.ok ? res.json() : null))
        .then((d: HealthData | null) => {
          if (d && Array.isArray(d.services)) setData(d);
        })
        .catch(() => {
          // Health endpoint unavailable — leave the list as-is rather than breaking the page.
        });
    };
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  if (!data) {
    return (
      <div className="space-y-3">
        {["Gemini AI", "Tavily search", "X API", "Reddit", "Bluesky"].map((name) => (
          <div key={name} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5 text-sm text-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse" />
              {name}
            </span>
            <span className="font-mono text-[11px] text-subtle">checking…</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.services.map((s) => {
        const meta = STATUS_META[s.status];
        return (
          <div key={s.id} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5 text-sm text-foreground">
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {s.name}
            </span>
            <span className="font-mono text-[11px] text-muted" title={s.detail}>
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
