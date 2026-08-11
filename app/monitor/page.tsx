"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import IssueCard from "@/components/monitor/IssueCard";
import DuplicatesSection from "@/components/monitor/DuplicatesSection";
import ServiceHealth from "@/components/ServiceHealth";

interface ScanResponse {
  sessionId?: string;
  newIssues?: Issue[];
  possibleDuplicates?: Duplicate[];
  skippedPlatforms?: (string | { platform: string; reason: string })[];
  aiUnavailable?: boolean;
  rawResults?: { title: string; url: string; content: string }[];
}

interface Issue {
  name: string;
  sentiment?: { positive: number; negative: number; uncertain: number };
  postUrls: { url: string; excerpt?: string }[];
  firstSeen?: string;
}

interface Duplicate {
  newIssueName: string;
  existingIssueId: string;
  existingIssueName: string;
  reason: string;
}

interface XUsageData {
  spentToday: number;
  budget: number;
  remaining: number;
  projectedCostPerScan: number;
  history: { date: string; reads: number; cost: number }[];
}

interface ScanHistory {
  id: string;
  topic: string;
  type: string | null;
  focus: string | null;
  platforms: string[];
  skipped: (string | { platform: string; reason: string })[];
  resultCount: number;
  newIssueCount: number;
  createdAt: string;
}

type BatchEvent =
  | { type: "start"; total: number; topic: string; subTargets: string[]; platforms: string[]; delaySeconds: number }
  | { type: "progress"; index: number; total: number; subTarget: string }
  | {
      type: "result";
      index: number;
      total: number;
      subTarget: string;
      resultCount: number;
      newIssueCount: number;
      duplicateCount: number;
      skippedPlatforms: (string | { platform: string; reason: string })[];
      newIssues: Issue[];
      possibleDuplicates: Duplicate[];
      aiUnavailable?: boolean;
      rawResults?: { title: string; url: string; content: string }[];
    }
  | { type: "skipped"; index: number; total: number; subTarget: string; reason: string }
  | { type: "error"; index: number; total: number; subTarget: string; error: string }
  | { type: "done"; total: number; completed: number; skipped: number; failed: number };

interface BatchItem {
  index: number;
  subTarget: string;
  status: "pending" | "running" | "ok" | "skipped" | "error";
  reason?: string;
  resultCount?: number;
  newIssueCount?: number;
  duplicateCount?: number;
}

const TYPE_OPTIONS = [
  "Auto Detect",
  "Brand/Company",
  "Product",
  "Crypto Project",
  "Wallet",
  "Blockchain",
  "Exchange",
  "Website/Platform",
  "Person",
  "Organization",
  "Market/Industry",
  "Location",
  "Other",
];

const PLATFORM_META: Record<string, { name: string; description: string }> = {
  web: { name: "Web", description: "Tavily web search" },
  reddit: { name: "Reddit", description: "Subreddit signal" },
  twitter: { name: "Twitter / X", description: "X API · metered reads" },
  bluesky: { name: "Bluesky", description: "AT Protocol feed" },
};

const TOPIC_EXAMPLES = [
  "mobile banking apps",
  "crypto wallets",
  "SaaS pricing changes",
  "AI assistants",
  "gaming consoles",
];

const FOCUS_SUGGESTIONS = ["security", "bugs", "complaints", "pricing", "sentiment"];

const SUBTARGET_EXAMPLE = "Phantom Wallet, MetaMask, Trust Wallet";

// ---------------------------------------------------------------------------
// Field styling. The background is a SOLID color so the autofill override
// below can match it exactly.
// ---------------------------------------------------------------------------
const FIELD_BG = "#FFFFFF";

// Root-cause fix for the recurring "first input is light" bug: Chrome paints
// autofilled text fields with its own light background via :-webkit-autofill,
// which ignores class-based background-color. The first text input on a form
// is exactly what browsers choose to autofill. Two layers of defense:
//   1. autoComplete="off" on the form stops the browser from autofilling.
//   2. This inset box-shadow + text-fill override keeps the field white even
//      if a browser autofills anyway (box-shadow paints above the autofill
//      background; the long transition prevents the flash).
// A project-wide copy of this guard also lives in globals.css.
const AUTOFILL_FIX: React.CSSProperties = {
  WebkitBoxShadow: `0 0 0 1000px ${FIELD_BG} inset`,
  WebkitTextFillColor: "#18181B",
  caretColor: "#18181B",
  transition: "background-color 10000000s ease-in-out 0s",
};

const inputClass =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-zinc-300 text-foreground text-sm placeholder:text-subtle focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 transition-all disabled:opacity-60 disabled:cursor-not-allowed";
const inputErrorClass =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-red-300 text-foreground text-sm placeholder:text-subtle focus:outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100 transition-all";

const cardClass = "card rounded-2xl";
const labelClass = "block mb-1.5 text-[13px] font-medium text-foreground";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-indigo-500 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";
const chipClass =
  "inline-flex items-center px-2 py-0.5 rounded-md bg-zinc-100 text-[10px] font-mono text-zinc-600";
const pickChip =
  "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 bg-white text-xs text-muted hover:text-foreground hover:border-zinc-300 hover:bg-zinc-50 transition-colors cursor-pointer select-none";

function dayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr.slice(5);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function MonitorPage() {
  const [topic, setTopic] = useState("");
  const [type, setType] = useState("Auto Detect");
  const [focus, setFocus] = useState("");
  const [batchFocus, setBatchFocus] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [subTargetsText, setSubTargetsText] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("30");
  const [platforms, setPlatforms] = useState<string[]>(["web"]);

  const [loading, setLoading] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [skippedPlatforms, setSkippedPlatforms] = useState<(string | { platform: string; reason: string })[]>([]);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [rawResults, setRawResults] = useState<{ title: string; url: string; content: string }[]>([]);

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState<"idle" | "running" | "done">("idle");
  const [batchCurrent, setBatchCurrent] = useState<{ index: number; total: number; subTarget: string } | null>(null);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchSummary, setBatchSummary] = useState<{ completed: number; skipped: number; failed: number } | null>(null);
  const [subTargetsError, setSubTargetsError] = useState(false);
  const batchAbortRef = useRef<AbortController | null>(null);
  // Tracks the active monitoring session per topic. Reusing the session across
  // scans of the same topic lets the server flag new issues that duplicate ones
  // already tracked (the "Possible Duplicates" section) instead of starting
  // fresh every time.
  const sessionRef = useRef<{ topic: string; id: string | null }>({ topic: "", id: null });

  const [platformStatus, setPlatformStatus] = useState<{
    reddit: boolean;
    redditPending: boolean;
    twitter: boolean;
    bluesky: boolean;
  } | null>(null);
  const [xUsage, setXUsage] = useState<XUsageData | null>(null);
  const [budgetEditing, setBudgetEditing] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<ScanHistory[]>([]);
  const [viewingScan, setViewingScan] = useState<ScanHistory | null>(null);
  const [pastScanIssues, setPastScanIssues] = useState<Issue[]>([]);
  const [pastScanLoading, setPastScanLoading] = useState(false);

  // Fetches today's X spend / budget; used on load and after each scan.
  const loadXUsage = useCallback(() => {
    fetch("/api/x-usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: XUsageData | null) => {
        if (
          data &&
          typeof data.spentToday === "number" &&
          typeof data.budget === "number" &&
          typeof data.remaining === "number" &&
          typeof data.projectedCostPerScan === "number" &&
          Array.isArray(data.history)
        ) {
          setXUsage(data);
        }
      })
      .catch(() => {
        // Endpoint unavailable — the usage card stays hidden; don't break the page.
      });
  }, []);

  // Fetches recent scan history; used on load and after each scan.
  const loadScans = useCallback(() => {
    fetch("/api/scans")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { scans?: ScanHistory[] } | null) => {
        if (data && Array.isArray(data.scans)) setRecentScans(data.scans);
      })
      .catch(() => {
        // Endpoint unavailable — the timeline stays hidden; don't break the page.
      });
  }, []);

  useEffect(() => {
    fetch("/api/platform-status")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: { reddit?: boolean; redditPending?: boolean; twitter?: boolean; bluesky?: boolean } | null) => {
          if (
            data &&
            typeof data.reddit === "boolean" &&
            typeof data.redditPending === "boolean" &&
            typeof data.twitter === "boolean" &&
            typeof data.bluesky === "boolean"
          ) {
            setPlatformStatus({
              reddit: data.reddit,
              redditPending: data.redditPending,
              twitter: data.twitter,
              bluesky: data.bluesky,
            });
          }
        }
      )
      .catch(() => {
        // Endpoint unavailable — notes stay hidden until a scan reports skips.
      });
    loadXUsage();
    loadScans();
  }, [loadXUsage, loadScans]);

  // A platform is "unconfigured" when its API keys are missing server-side.
  const redditUnconfigured =
    platformStatus !== null ? !platformStatus.reddit : skippedPlatforms.includes("reddit");
  // Reddit's API requires pre-approval for new apps; REDDIT_API_REQUESTED marks
  // a submitted-but-unapproved request so the UI shows "pending" not "missing".
  const redditPending = platformStatus !== null ? platformStatus.redditPending : false;
  const twitterUnconfigured =
    platformStatus !== null ? !platformStatus.twitter : skippedPlatforms.includes("twitter");
  const blueskyUnconfigured =
    platformStatus !== null ? !platformStatus.bluesky : skippedPlatforms.includes("bluesky");

  // X is disabled once a single scan would no longer fit in the remaining
  // budget (matches the server-side "daily budget reached" skip).
  const xBudgetReached = xUsage !== null && xUsage.remaining < xUsage.projectedCostPerScan;

  // If the budget runs out (e.g. a scan just consumed it), uncheck Twitter so
  // it isn't submitted and then silently skipped by the scan route.
  useEffect(() => {
    if (xBudgetReached) {
      setPlatforms((prev) => (prev.includes("twitter") ? prev.filter((p) => p !== "twitter") : prev));
    }
  }, [xBudgetReached]);

  const togglePlatform = (platform: string) => {
    setPlatforms((prev) => (prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]));
  };

  const startBudgetEdit = () => {
    setBudgetDraft(String(xUsage?.budget ?? 3));
    setBudgetEditing(true);
    setBudgetError(null);
  };

  const cancelBudgetEdit = () => {
    setBudgetEditing(false);
    setBudgetError(null);
  };

  const saveBudget = async () => {
    const v = Number(budgetDraft);
    if (!Number.isFinite(v) || v <= 0) {
      setBudgetError("Enter a positive amount");
      return;
    }
    setBudgetSaving(true);
    setBudgetError(null);
    try {
      const res = await fetch("/api/x-usage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget: v }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Failed to update budget");
      }
      const data: XUsageData = await res.json();
      setXUsage(data);
      setBudgetEditing(false);
    } catch (err) {
      setBudgetError(err instanceof Error ? err.message : "Failed to update budget");
    } finally {
      setBudgetSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setHasScanned(true);
    setError(null);
    setAiUnavailable(false);
    setRawResults([]);
    closePastScan();
    // Reuse the session when scanning the same topic so new issues are
    // deduped against already-tracked ones; start a fresh session on a new topic.
    if (sessionRef.current.topic !== topic) {
      sessionRef.current = { topic, id: null };
    }
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          type,
          focus,
          platforms,
          ...(sessionRef.current.id ? { sessionId: sessionRef.current.id } : {}),
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Scan request failed");
      }
      const data: ScanResponse = await res.json();
      if (!sessionRef.current.id && data.sessionId) sessionRef.current.id = data.sessionId;
      setIssues(data.newIssues ?? []);
      setDuplicates(data.possibleDuplicates ?? []);
      setSkippedPlatforms(data.skippedPlatforms ?? []);
      setAiUnavailable(data.aiUnavailable ?? false);
      setRawResults(data.rawResults ?? []);
      loadXUsage();
      loadScans();
    } catch (err: unknown) {
      if (err instanceof TypeError) {
        // fetch() rejects with a TypeError when the connection drops or the
        // server dies mid-request — surface something actionable, not "fetch failed".
        setError(
          "Couldn't reach the scan service — the connection dropped. Try again in a moment."
        );
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unexpected error");
      }
    } finally {
      setLoading(false);
    }
  };

  // Loads a past scan's persisted issues so they can be reviewed (not re-run).
  const openPastScan = async (s: ScanHistory) => {
    setViewingScan(s);
    setPastScanIssues([]);
    setPastScanLoading(true);
    try {
      const res = await fetch(`/api/scans/${s.id}`);
      if (!res.ok) throw new Error("Failed to load scan results");
      const data = (await res.json()) as { issues?: Issue[] };
      setPastScanIssues(data.issues ?? []);
    } catch (err) {
      setPastScanIssues([]);
      setError(err instanceof Error ? err.message : "Failed to load scan results");
    } finally {
      setPastScanLoading(false);
    }
  };

  const closePastScan = () => {
    setViewingScan(null);
    setPastScanIssues([]);
  };

  // Re-fills the form from a past scan (Recent scans timeline).
  const rerunScan = (s: ScanHistory) => {
    setBatchMode(false);
    setTopic(s.topic);
    setType(s.type || "Auto Detect");
    setFocus(s.focus || "");
    setPlatforms(s.platforms.length > 0 ? s.platforms : ["web"]);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Clears the current results for a fresh scan.
  const clearResults = () => {
    setIssues([]);
    setDuplicates([]);
    setSkippedPlatforms([]);
    setAiUnavailable(false);
    setRawResults([]);
    closePastScan();
    setBatchStatus("idle");
    setBatchItems([]);
    setBatchSummary(null);
    setHasScanned(false);
    setError(null);
    sessionRef.current = { topic: "", id: null };
  };

  // --- Batch mode -----------------------------------------------------------

  const parsedTargets = subTargetsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Comma-separated focus list helpers (multi-focus: chips toggle individual terms).
  const parseFocusTerms = (value: string) =>
    value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  const toggleFocusTerm = (value: string, setter: (v: string) => void, term: string) => {
    const terms = parseFocusTerms(value);
    const idx = terms.findIndex((t) => t.toLowerCase() === term.toLowerCase());
    if (idx >= 0) terms.splice(idx, 1);
    else terms.push(term);
    setter(terms.join(", "));
  };
  const focusTerms = parseFocusTerms(focus).map((t) => t.toLowerCase());
  const batchFocusTerms = parseFocusTerms(batchFocus).map((t) => t.toLowerCase());

  const applyBatchEvent = (evt: BatchEvent) => {
    switch (evt.type) {
      case "progress":
        setBatchCurrent({ index: evt.index, total: evt.total, subTarget: evt.subTarget });
        setBatchItems((prev) =>
          prev.map((item) => (item.index === evt.index ? { ...item, status: "running" } : item))
        );
        break;
      case "result":
        setBatchItems((prev) =>
          prev.map((item) =>
            item.index === evt.index
              ? {
                  ...item,
                  status: "ok",
                  resultCount: evt.resultCount,
                  newIssueCount: evt.newIssueCount,
                  duplicateCount: evt.duplicateCount,
                }
              : item
          )
        );
        if (evt.newIssues.length > 0) setIssues((prev) => [...prev, ...evt.newIssues]);
        if (evt.possibleDuplicates.length > 0) setDuplicates((prev) => [...prev, ...evt.possibleDuplicates]);
        if (evt.aiUnavailable) {
          setAiUnavailable(true);
          const raw = evt.rawResults ?? [];
          if (raw.length > 0) setRawResults((prev) => [...prev, ...raw]);
        }
        break;
      case "skipped":
        setBatchItems((prev) =>
          prev.map((item) => (item.index === evt.index ? { ...item, status: "skipped", reason: evt.reason } : item))
        );
        break;
      case "error":
        setBatchItems((prev) =>
          prev.map((item) => (item.index === evt.index ? { ...item, status: "error", reason: evt.error } : item))
        );
        break;
      case "done":
        setBatchSummary({ completed: evt.completed, skipped: evt.skipped, failed: evt.failed });
        break;
      default:
        break;
    }
  };

  const runBatch = async () => {
    if (parsedTargets.length === 0) {
      setSubTargetsError(true);
      setError("Enter at least one sub-target (comma-separated).");
      return;
    }
    if (platforms.length === 0) {
      setError("Select at least one platform.");
      return;
    }
    setSubTargetsError(false);
    const delay = Math.min(Math.max(Number(delaySeconds) || 30, 0), 120);

    setError(null);
    setHasScanned(true);
    setIssues([]);
    setDuplicates([]);
    setAiUnavailable(false);
    setRawResults([]);
    closePastScan();
    setBatchItems(parsedTargets.map((t, i) => ({ index: i, subTarget: t, status: "pending" })));
    setBatchCurrent(null);
    setBatchSummary(null);
    setBatchStatus("running");
    setBatchRunning(true);

    const abort = new AbortController();
    batchAbortRef.current = abort;

    try {
      const res = await fetch("/api/batch-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, type, focus: batchFocus, subTargets: parsedTargets, platforms, delaySeconds: delay }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Batch request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: BatchEvent;
          try {
            evt = JSON.parse(line) as BatchEvent;
          } catch {
            continue;
          }
          applyBatchEvent(evt);
        }
      }
    } catch (err: unknown) {
      if (abort.signal.aborted) {
        setBatchItems((prev) =>
          prev.map((item) =>
            item.status === "running" || item.status === "pending"
              ? { ...item, status: "skipped", reason: "cancelled" }
              : item
          )
        );
        setError("Batch cancelled.");
      } else if (err instanceof TypeError) {
        setError("Couldn't reach the scan service — the connection dropped. Try again in a moment.");
      } else {
        setError(err instanceof Error ? err.message : "Batch failed");
      }
    } finally {
      setBatchRunning(false);
      setBatchStatus("done");
      batchAbortRef.current = null;
      loadXUsage();
      loadScans();
    }
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  // --- Derived --------------------------------------------------------------

  const skippedWithReasons = skippedPlatforms.filter(
    (s): s is { platform: string; reason: string } => typeof s !== "string"
  );
  const usagePct = xUsage && xUsage.budget > 0 ? Math.min(100, (xUsage.spentToday / xUsage.budget) * 100) : 0;
  const maxCost = xUsage ? Math.max(...xUsage.history.map((h) => h.cost), 0.01) : 0.01;
  const batchProgressPct =
    batchCurrent && batchCurrent.total > 0 ? Math.round((batchCurrent.index / batchCurrent.total) * 100) : 0;

  // Stat tiles for the dashboard strip (above the scan form).
  const statTiles = [
    { label: "Recent scans", value: String(recentScans.length) },
    {
      label: "New issues",
      value: String(recentScans.reduce((sum, s) => sum + (s.newIssueCount || 0), 0)),
    },
    {
      label: "X spend today",
      value: xUsage ? `$${xUsage.spentToday.toFixed(2)}` : "—",
    },
    {
      label: "Budget left",
      value: xUsage ? `$${xUsage.remaining.toFixed(2)}` : "—",
    },
  ];

  // Topics from past scans (most recent first, unique) for one-click re-runs.
  const recentTopics = Array.from(new Set(recentScans.map((s) => s.topic).filter(Boolean))).slice(0, 3);
  const pickChips = [...recentTopics, ...TOPIC_EXAMPLES.filter((t) => !recentTopics.includes(t))].slice(0, 5);

  return (
    <div className="space-y-14 sm:space-y-20">
      {/* Breadcrumb & Header */}
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-xs font-mono text-subtle">
          <Link href="/" className="hover:text-foreground transition-colors">
            Ripple
          </Link>
          <span>/</span>
          <span className="text-foreground">Monitor</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-7 border-b border-zinc-200">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-2.5">
              Signal monitoring
            </p>
            <h1 className="font-display text-5xl sm:text-6xl font-semibold text-foreground tracking-tight leading-[0.98]">
              Monitor
            </h1>
            <p className="text-[15px] text-muted mt-3 max-w-xl leading-relaxed">
              Scan the web and social platforms for emerging issues, then cluster them with AI.
            </p>
          </div>
          <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-zinc-200 bg-white text-xs font-mono text-muted shadow-card self-start sm:self-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-positive" />
            {xUsage
              ? `$${xUsage.spentToday.toFixed(2)} / $${xUsage.budget.toFixed(2)} X spend today`
              : "System ready"}
          </div>
        </div>
      </div>

      {/* Dashboard stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statTiles.map((t) => (
          <div key={t.label} className="card rounded-xl p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1.5">
              {t.label}
            </p>
            <p className="font-mono text-xl text-foreground">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main column */}
        <div className="space-y-8 min-w-0">
          {/* Scan form */}
          <form
            onSubmit={batchMode ? (e) => e.preventDefault() : handleSubmit}
            autoComplete="off"
            className={`${cardClass} p-6 sm:p-8 space-y-7`}
          >
            {/* Header + mode toggle */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight">
                  {batchMode ? "Batch scan" : "Single scan"}
                </h2>
                <p className="text-xs text-muted mt-1">
                  {batchMode
                    ? "Run each sub-target as its own scan, sequentially."
                    : "One topic, one pass across the selected platforms."}
                </p>
              </div>
              <div
                className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5"
                role="group"
                aria-label="Scan mode"
              >
                <button
                  type="button"
                  onClick={() => setBatchMode(false)}
                  disabled={batchRunning}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all disabled:cursor-not-allowed ${
                    !batchMode
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setBatchMode(true)}
                  disabled={batchRunning}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all disabled:cursor-not-allowed ${
                    batchMode
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  Batch
                </button>
              </div>
            </div>

            {/* Topic */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="topic" className="text-[13px] font-medium text-foreground">
                  Topic
                </label>
                <span className="font-mono text-[10px] text-subtle uppercase tracking-wider">
                  required
                </span>
              </div>
              <input
                id="topic"
                type="text"
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. mobile banking apps, a product name, a brand…"
                className={inputClass}
                style={AUTOFILL_FIX}
                disabled={batchRunning}
              />
              {topic === "" && !batchRunning && pickChips.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-subtle mr-0.5">
                    Try
                  </span>
                  {pickChips.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className={pickChip}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Type */}
              <div>
                <label htmlFor="type" className={labelClass}>
                  Monitor type
                </label>
                <select
                  id="type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className={`${inputClass} cursor-pointer`}
                  disabled={batchRunning}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              {/* Focus or sub-targets */}
              {batchMode ? (
                <div className="space-y-5">
                  <div>
                    <label htmlFor="subTargets" className={labelClass}>
                      Sub-targets{" "}
                      <span className="text-muted font-normal text-xs">(comma-separated)</span>
                    </label>
                    <textarea
                      id="subTargets"
                      rows={2}
                      value={subTargetsText}
                      onChange={(e) => {
                        setSubTargetsText(e.target.value);
                        setSubTargetsError(false);
                      }}
                      placeholder={SUBTARGET_EXAMPLE}
                      className={`${subTargetsError ? inputErrorClass : inputClass} resize-none`}
                      style={AUTOFILL_FIX}
                      disabled={batchRunning}
                      aria-invalid={subTargetsError}
                    />
                    <p
                      className={`mt-1.5 text-[11px] font-mono ${
                        subTargetsError ? "text-negative" : "text-subtle"
                      }`}
                    >
                      {subTargetsError
                        ? "Enter at least one sub-target"
                        : parsedTargets.length > 0
                        ? `${parsedTargets.length} sub-target${parsedTargets.length > 1 ? "s" : ""} ready`
                        : "Separate with commas — one scan runs per line item"}
                    </p>
                    {subTargetsText === "" && !batchRunning && (
                      <button
                        type="button"
                        onClick={() => setSubTargetsText(SUBTARGET_EXAMPLE)}
                        className={`${pickChip} mt-1`}
                      >
                        Use example: {SUBTARGET_EXAMPLE}
                      </button>
                    )}
                  </div>

                  {/* Focus types applied to every sub-target */}
                  <div>
                    <label htmlFor="batchFocus" className={labelClass}>
                      Focus on{" "}
                      <span className="text-muted font-normal text-xs">
                        (applies to all sub-targets)
                      </span>
                    </label>
                    <input
                      id="batchFocus"
                      type="text"
                      value={batchFocus}
                      onChange={(e) => setBatchFocus(e.target.value)}
                      placeholder="e.g. bugs, complaints, security, pricing"
                      className={inputClass}
                      style={AUTOFILL_FIX}
                      disabled={batchRunning}
                    />
                    {!batchRunning && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {FOCUS_SUGGESTIONS.map((s) => {
                          const active = batchFocusTerms.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleFocusTerm(batchFocus, setBatchFocus, s)}
                              className={`${pickChip} ${
                                active
                                  ? "border-accent/50 bg-indigo-50 text-accent hover:text-accent"
                                  : ""
                              }`}
                            >
                              {active ? "✓" : "+"} {s}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="focus" className={labelClass}>
                    Focus{" "}
                    <span className="text-muted font-normal text-xs">(biases search, doesn&apos;t filter)</span>
                  </label>
                  <input
                    id="focus"
                    type="text"
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder="e.g. security, bugs, complaints, pricing"
                    className={inputClass}
                    style={AUTOFILL_FIX}
                    disabled={batchRunning}
                  />
                  {!batchRunning && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {FOCUS_SUGGESTIONS.map((s) => {
                        const active = focusTerms.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleFocusTerm(focus, setFocus, s)}
                            className={`${pickChip} ${
                              active
                                ? "border-accent/50 bg-indigo-50 text-accent hover:text-accent"
                                : ""
                            }`}
                          >
                            {active ? "✓" : "+"} {s}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Batch pacing */}
            {batchMode && (
              <div className="grid gap-5 sm:grid-cols-2 items-end">
                <div>
                  <label htmlFor="delay" className={labelClass}>
                    Delay between scans (seconds)
                  </label>
                  <input
                    id="delay"
                    type="number"
                    min={0}
                    max={120}
                    step={5}
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(e.target.value)}
                    className={inputClass}
                    style={AUTOFILL_FIX}
                    disabled={batchRunning}
                  />
                </div>
                <p className="text-xs text-muted leading-relaxed pb-1.5">
                  Each sub-target runs as its own scan, biased toward the focus types above{" "}
                  (e.g. <code className="font-mono text-accent">bugs</code>,{" "}
                  <code className="font-mono text-accent">complaints</code>) plus the sub-target
                  itself. The X daily budget is enforced across the whole batch — once it&apos;s
                  reached, the remaining sub-targets are skipped.
                </p>
              </div>
            )}

            {/* Platforms */}
            <div className="pt-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-3">
                Platforms
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {Object.entries(PLATFORM_META).map(([id, meta]) => {
                  const checked = platforms.includes(id);
                  let disabled = false;
                  let note: React.ReactNode = null;

                  if (id === "twitter") {
                    if (xBudgetReached) {
                      disabled = true;
                      note = <span className="text-negative font-medium">daily budget reached</span>;
                    } else if (twitterUnconfigured) {
                      note = <span className="text-uncertain">no API key configured</span>;
                    }
                  } else if (id === "reddit" && redditUnconfigured) {
                    note = redditPending ? (
                      <span className="text-uncertain">API request submitted — awaiting approval</span>
                    ) : (
                      <span className="text-uncertain">no API key configured</span>
                    );
                  } else if (id === "bluesky" && blueskyUnconfigured) {
                    note = <span className="text-uncertain">no API key configured</span>;
                  }

                  return (
                    <label
                      key={id}
                      className={`flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                        disabled ? "opacity-50 cursor-not-allowed" : ""
                      } ${
                        checked
                          ? "border-accent/60 bg-indigo-50/60 shadow-[0_0_0_1px_rgba(79,70,229,0.15)]"
                          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={checked}
                        disabled={disabled || batchRunning}
                        onChange={() => togglePlatform(id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">{meta.name}</span>
                          <span
                            className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                              checked ? "bg-accent border-accent" : "bg-white border-zinc-300"
                            }`}
                          >
                            <svg
                              className={`w-3 h-3 text-white transition-opacity ${
                                checked ? "opacity-100" : "opacity-0"
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3.5}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        </span>
                        <span className="block text-xs text-muted mt-0.5">{meta.description}</span>
                        {note && <span className="block text-[11px] font-mono mt-1.5">{note}</span>}
                        {id === "twitter" && xUsage && !xBudgetReached && (
                          <span className="block text-[11px] font-mono text-subtle mt-1">
                            ${xUsage.spentToday.toFixed(2)} / ${xUsage.budget.toFixed(2)} today
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              {xBudgetReached && (
                <p className="mt-2.5 text-xs text-muted font-body">
                  The X daily budget is reached — the X platform will be skipped until it resets.
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              {batchRunning ? (
                <div className="w-full space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-foreground font-medium truncate">
                      {batchCurrent
                        ? `Scanning ${batchCurrent.index + 1} of ${batchCurrent.total}: ${batchCurrent.subTarget}…`
                        : "Preparing batch…"}
                    </p>
                    <button
                      type="button"
                      onClick={cancelBatch}
                      className="text-xs font-mono text-muted hover:text-negative transition-colors shrink-0"
                    >
                      cancel
                    </button>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${batchProgressPct}%` }}
                    />
                  </div>
                </div>
              ) : batchMode ? (
                <button
                  type="button"
                  onClick={runBatch}
                  disabled={platforms.length === 0}
                  className={`${primaryBtn} w-full sm:w-auto`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Run Batch
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading || platforms.length === 0}
                  className={`${primaryBtn} w-full sm:w-auto ${loading ? "ripple-loading" : ""}`}
                >
                  {loading ? "Scanning…" : "Run Scan"}
                </button>
              )}
              <span className="font-mono text-[11px] text-subtle">
                {platforms.length === 0
                  ? "Select at least one platform"
                  : batchMode
                  ? `${platforms.length} platform${platforms.length > 1 ? "s" : ""} selected`
                  : `POST /api/scan · ${platforms.length} platform${platforms.length > 1 ? "s" : ""}`}
              </span>
            </div>
          </form>

          {/* Error */}
          {error && (
            <div className="p-5 rounded-2xl border border-red-200 bg-red-50 text-red-700 font-body space-y-1">
              <p className="text-[15px] font-semibold">{error}</p>
              <p className="text-sm text-red-500">
                If this keeps happening, the AI service may be unreachable from your network —
                check your connection and try again shortly.
              </p>
            </div>
          )}

          {/* Batch results */}
          {batchStatus !== "idle" && (
            <div className={`${cardClass} p-5 sm:p-7 space-y-4`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-display text-xl font-semibold text-foreground tracking-tight">
                    Batch results
                  </h2>
                  {batchSummary && !batchRunning && (
                    <p className="text-xs text-muted mt-0.5 font-mono">
                      {batchSummary.completed} completed · {batchSummary.skipped} skipped ·{" "}
                      {batchSummary.failed} failed
                    </p>
                  )}
                </div>
                {batchRunning && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono text-accent">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    running
                  </span>
                )}
              </div>

              <ol className="divide-y divide-zinc-100">
                {batchItems.map((item) => (
                  <li key={item.index} className="flex items-start gap-3 py-3">
                    {item.status === "ok" && (
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-positive/10 text-positive flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    {item.status === "skipped" && (
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-amber-50 text-uncertain flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-red-50 text-negative flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </span>
                    )}
                    {item.status === "running" && (
                      <span className="mt-0.5 w-5 h-5 rounded-full border border-accent/40 flex items-center justify-center shrink-0">
                        <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                      </span>
                    )}
                    {item.status === "pending" && (
                      <span className="mt-0.5 w-5 h-5 rounded-full border border-zinc-200 flex items-center justify-center shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-subtle" />
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground font-medium truncate" title={item.subTarget}>
                          {item.subTarget}
                        </span>
                        <span
                          className={`font-mono text-[11px] shrink-0 ${
                            item.status === "ok"
                              ? "text-positive"
                              : item.status === "skipped"
                              ? "text-uncertain"
                              : item.status === "error"
                              ? "text-negative"
                              : "text-subtle"
                          }`}
                        >
                          {item.status === "running"
                            ? "scanning…"
                            : item.status === "pending"
                            ? "queued"
                            : item.status}
                        </span>
                      </div>
                      {item.status === "ok" && (
                        <p className="text-xs text-muted font-mono mt-0.5">
                          {item.resultCount} results · {item.newIssueCount} new issues
                          {item.duplicateCount ? ` · ${item.duplicateCount} possible dupe${item.duplicateCount > 1 ? "s" : ""}` : ""}
                        </p>
                      )}
                      {(item.status === "skipped" || item.status === "error") && item.reason && (
                        <p className="text-xs text-muted mt-0.5 truncate" title={item.reason}>
                          {item.reason}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* AI clustering unavailable — graceful fallback with raw results */}
          {aiUnavailable && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 text-sm space-y-1">
                <p className="font-mono text-xs text-uncertain uppercase tracking-wider">
                  AI clustering unavailable
                </p>
                <p className="text-muted">
                  The web search succeeded, but the AI service couldn&apos;t be reached from this
                  network — showing raw results instead. Scans will cluster into issues again once
                  the AI service is reachable.
                </p>
              </div>
              {rawResults.length > 0 && (
                <div className={`${cardClass} p-5 sm:p-6 space-y-3`}>
                  <p className="font-mono text-[11px] text-muted uppercase tracking-wider">
                    Raw results ({rawResults.length})
                  </p>
                  <ul className="space-y-4">
                    {rawResults.map((r, idx) => (
                      <li key={idx} className="space-y-1 min-w-0">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent2 hover:underline underline-offset-2 transition-colors block min-w-0 break-all font-mono text-xs"
                        >
                          {r.url}
                        </a>
                        <p className="text-sm text-foreground font-medium leading-snug">{r.title}</p>
                        {r.content && (
                          <p className="text-xs text-muted leading-relaxed line-clamp-2">
                            {r.content}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Skipped platforms notice (single scan) */}
          {!batchMode && skippedWithReasons.length > 0 && (
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/70 text-sm space-y-1.5">
              <p className="font-mono text-xs text-uncertain uppercase tracking-wider">
                Skipped this scan
              </p>
              {skippedWithReasons.map((s, idx) => (
                <p key={idx} className="text-muted">
                  <span className="text-foreground font-medium capitalize">{s.platform}</span>
                  <span className="text-muted"> — {s.reason}</span>
                </p>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && !batchRunning && !error && !aiUnavailable && issues.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-12 text-center space-y-2">
              <div className="w-10 h-10 mx-auto rounded-xl bg-zinc-100 text-subtle flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20.25l-.75-3.25a4.5 4.5 0 00-3.25-3.25L1.75 13l3.25-.75a4.5 4.5 0 003.25-3.25L9 5.75l.75 3.25a4.5 4.5 0 003.25 3.25L16.25 13l-3.25.75a4.5 4.5 0 00-3.25 3.25z" />
                </svg>
              </div>
              <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight">
                {hasScanned ? "No issues detected" : "Ready to scan"}
              </h2>
              <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
                {hasScanned
                  ? "This scan surfaced no emergent issues. Try a different topic, focus, or platform mix."
                  : "Pick a topic from the suggestions, or type your own — then choose platforms and run the scan."}
              </p>
            </div>
          )}

          {/* Detected issues */}
          {issues.length > 0 && (
            <section className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight">
                  Detected Issues{" "}
                  <span className="font-mono text-sm font-normal text-subtle">({issues.length})</span>
                </h2>
                <button
                  type="button"
                  onClick={clearResults}
                  className="text-xs font-medium text-muted hover:text-foreground transition-colors"
                >
                  New scan →
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {issues.map((issue, idx) => (
                  <IssueCard key={idx} issue={issue} />
                ))}
              </div>
            </section>
          )}

          {duplicates.length > 0 && <DuplicatesSection duplicates={duplicates} />}

          {/* Past scan results (opened from the history timeline) */}
          {viewingScan && (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-1.5">
                    Past scan · {formatTime(viewingScan.createdAt)}
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight truncate">
                    {viewingScan.topic}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closePastScan}
                  className="text-xs font-medium text-muted hover:text-foreground transition-colors"
                >
                  ← Back to current results
                </button>
              </div>
              {pastScanLoading ? (
                <div className="card rounded-2xl p-8 text-center font-mono text-sm text-muted">
                  Loading past scan…
                </div>
              ) : pastScanIssues.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {pastScanIssues.map((issue, idx) => (
                    <IssueCard key={idx} issue={issue} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-8 text-center">
                  <p className="text-[15px] font-semibold text-foreground">No issues recorded</p>
                  <p className="text-sm text-muted mt-1">
                    This scan found no persisted issues (or its results have expired).
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-8 lg:sticky lg:top-24 self-start">
          {/* X usage card */}
          <div className={`${cardClass} p-5 sm:p-6 space-y-5`}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-foreground tracking-tight">X API usage</h2>
              <span
                className={`w-1.5 h-1.5 rounded-full ${xBudgetReached ? "bg-negative" : "bg-accent"}`}
              />
            </div>

            {xUsage ? (
              <>
                {/* Adjustable daily budget */}
                <div>
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-muted">Daily budget</span>
                    {budgetEditing ? (
                      <span className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0.01}
                          step={0.25}
                          value={budgetDraft}
                          onChange={(e) => setBudgetDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveBudget();
                            if (e.key === "Escape") cancelBudgetEdit();
                          }}
                          aria-label="Daily budget in USD"
                          className="w-20 px-2 py-0.5 rounded-md bg-white border border-zinc-300 text-foreground text-xs font-mono focus:border-accent focus:ring-4 focus:ring-accent/10 outline-none"
                          style={AUTOFILL_FIX}
                        />
                        <button onClick={saveBudget} disabled={budgetSaving} className="text-accent hover:text-indigo-600 disabled:opacity-50 transition-colors">
                          save
                        </button>
                        <button onClick={cancelBudgetEdit} className="text-muted hover:text-foreground transition-colors">
                          cancel
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="text-foreground">${xUsage.budget.toFixed(2)}</span>
                        <button
                          onClick={startBudgetEdit}
                          title="Adjust daily budget"
                          aria-label="Adjust daily budget"
                          className="text-subtle hover:text-accent transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                            />
                          </svg>
                        </button>
                      </span>
                    )}
                  </div>
                  {budgetError && <p className="text-[11px] font-mono text-negative mt-1">{budgetError}</p>}
                </div>

                <div>
                  <div className="flex items-baseline justify-between font-mono text-xs mb-2">
                    <span className="text-muted">
                      ${xUsage.spentToday.toFixed(2)} / ${xUsage.budget.toFixed(2)}
                    </span>
                    <span className={xBudgetReached ? "text-negative" : "text-positive"}>
                      {xBudgetReached ? "budget reached" : `$${xUsage.remaining.toFixed(2)} left`}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${xBudgetReached ? "bg-negative" : "bg-accent"}`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">
                      Today&apos;s reads
                    </p>
                    <p className="font-mono text-lg text-foreground">
                      {xUsage.history.length > 0 ? xUsage.history[xUsage.history.length - 1].reads : 0}
                    </p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1">
                      Per scan cap
                    </p>
                    <p className="font-mono text-lg text-foreground">${xUsage.projectedCostPerScan.toFixed(2)}</p>
                  </div>
                </div>

                {/* 7-day history */}
                <div>
                  <p className="font-mono text-[10px] text-muted uppercase tracking-wider mb-3">
                    Last 7 days
                  </p>
                  <div className="flex items-end gap-1.5 h-24">
                    {xUsage.history.map((h) => {
                      const isToday = h.date === xUsage.history[xUsage.history.length - 1].date;
                      const hgt = h.cost > 0 ? Math.max(8, (h.cost / maxCost) * 100) : 3;
                      return (
                        <div
                          key={h.date}
                          className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
                          title={`${h.date} · ${h.reads} reads · $${h.cost.toFixed(2)}`}
                        >
                          <div className="w-full flex items-end justify-center flex-1">
                            <div
                              className={`w-full max-w-[22px] rounded-t-md transition-all ${
                                isToday ? "bg-accent" : h.cost > 0 ? "bg-zinc-300" : "bg-zinc-100"
                              }`}
                              style={{ height: `${hgt}%` }}
                            />
                          </div>
                          <span
                            className={`text-[10px] font-mono leading-none ${
                              isToday ? "text-foreground" : "text-subtle"
                            }`}
                          >
                            {dayLabel(h.date)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted font-body">Loading usage…</p>
            )}
          </div>

          {/* Recent scans timeline */}
          <div className={`${cardClass} p-5 sm:p-6 space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-foreground tracking-tight">Recent scans</h2>
              {recentScans.length > 0 && (
                <span className="font-mono text-[11px] text-subtle">{recentScans.length} shown</span>
              )}
            </div>
            {recentScans.length === 0 ? (
              <p className="text-sm text-muted font-body">No scans yet — run one to see its history here.</p>
            ) : (
              <ol className="space-y-4">
                {recentScans.map((s) => (
                  <li key={s.id} className="relative pl-4 border-l-2 border-zinc-100 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openPastScan(s)}
                        title="View this scan's results"
                        aria-label={`View results for ${s.topic}`}
                        className="text-sm text-foreground font-medium truncate text-left hover:text-accent transition-colors"
                      >
                        {s.topic}
                        {s.focus && (
                          <span className="text-muted font-normal">
                            {" "}→ {s.focus}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => rerunScan(s)}
                        title="Re-run this scan"
                        aria-label={`Re-run scan for ${s.topic}`}
                        className="font-mono text-[11px] text-subtle hover:text-accent transition-colors shrink-0"
                      >
                        ↻ rerun
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.platforms.map((p) => (
                        <span key={p} className={chipClass}>
                          {p}
                        </span>
                      ))}
                      {s.skipped.map((sk, i) => (
                        <span
                          key={i}
                          title={typeof sk === "string" ? sk : `${sk.platform}: ${sk.reason}`}
                          className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-[10px] font-mono text-uncertain"
                        >
                          {typeof sk === "string" ? sk : `${sk.platform} · ${sk.reason}`}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] font-mono text-muted">
                      {formatTime(s.createdAt)} · {s.resultCount} results · {s.newIssueCount} new issues
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Platform status card */}
          <div className={`${cardClass} p-5 sm:p-6 space-y-3`}>
            <h2 className="font-display text-xl font-semibold text-foreground tracking-tight">Channels</h2>
            <ServiceHealth />
          </div>
        </aside>
      </div>
    </div>
  );
}
