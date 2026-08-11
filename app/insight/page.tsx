"use client";

import Link from "next/link";
import { useState } from "react";

interface PostSource {
  url: string;
  excerpt: string;
}

interface Issue {
  name: string;
  sentiment?: { positive: number; negative: number; uncertain: number };
  postUrls?: PostSource[];
  firstSeen?: string;
}

interface QueryApiResponse {
  query?: string;
  detailedResults?: Issue[];
  summaryText?: string;
  results?: string | Issue[];
  sources?: PostSource[];
  error?: string;
}

const FIELD_BG = "#FFFFFF";

// Autofill guard — same root-cause fix as the monitor page; also applied
// project-wide in globals.css.
const AUTOFILL_FIX: React.CSSProperties = {
  WebkitBoxShadow: `0 0 0 1000px ${FIELD_BG} inset`,
  WebkitTextFillColor: "#18181B",
  caretColor: "#18181B",
  transition: "background-color 10000000s ease-in-out 0s",
};

const inputClass =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-zinc-300 text-foreground text-sm placeholder:text-subtle focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 transition-all";

const pickChip =
  "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-zinc-200 bg-white text-xs text-muted hover:text-foreground hover:border-zinc-300 hover:bg-zinc-50 transition-colors cursor-pointer select-none";

const QUERY_EXAMPLES = [
  "what are people saying about Paystack this month?",
  "recent complaints about Coinbase support",
  "sentiment on the latest iPhone release",
  "emerging bugs in Notion",
];

const CATEGORY_SUGGESTIONS = ["pricing", "reliability", "security", "customer support", "UX"];

export default function InsightPage() {
  const [query, setQuery] = useState("");
  const [categoryFocus, setCategoryFocus] = useState("");
  const [outputFormat, setOutputFormat] = useState<"summary" | "detailed">("detailed");
  const [showSentiment, setShowSentiment] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sources, setSources] = useState<PostSource[]>([]);
  const [copied, setCopied] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSummary("");
    setIssues([]);
    setSources([]);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          options: {
            platforms: ["web"],
            showSentimentBreakdown: showSentiment,
            ...(categoryFocus && { categoryFocus }),
          },
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Query request failed");
      }
      const data: QueryApiResponse = await res.json();
      if (data.error) throw new Error(data.error);

      setSources(data.sources ?? []);
      setSummary(data.summaryText ?? (typeof data.results === "string" ? data.results : ""));
      setIssues(data.detailedResults ?? (Array.isArray(data.results) ? (data.results as Issue[]) : []));
    } catch (err: unknown) {
      if (err instanceof TypeError) {
        setError("Couldn't reach the query service — the connection dropped. Try again in a moment.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Unexpected error");
      }
    } finally {
      setLoading(false);
    }
  };

  const copySummary = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="space-y-14 sm:space-y-20">
      {/* Breadcrumb & Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-mono text-subtle">
          <Link href="/" className="hover:text-foreground transition-colors">
            Ripple
          </Link>
          <span>/</span>
          <span className="text-foreground">Insight</span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-7 border-b border-zinc-200">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted mb-2.5">
              AI synthesis
            </p>
            <h1 className="font-display text-5xl sm:text-6xl font-semibold text-foreground tracking-tight leading-[0.98]">
              Insight
            </h1>
            <p className="text-[15px] text-muted mt-3 leading-relaxed">AI-driven synthesis and issue clustering</p>
          </div>
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-zinc-200 bg-white text-xs font-mono text-muted shadow-card self-start sm:self-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-positive" />
            Ready
          </div>
        </div>
      </div>

      {/* Query Form */}
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="card rounded-2xl p-6 sm:p-8 space-y-7 max-w-2xl"
      >
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="query" className="text-[13px] font-medium text-foreground">
              Query
            </label>
            <span className="font-mono text-[10px] text-subtle uppercase tracking-wider">required</span>
          </div>
          <textarea
            id="query"
            required
            rows={3}
            placeholder="e.g. what are people saying about Paystack this month?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${inputClass} resize-y`}
            style={AUTOFILL_FIX}
          />
          {query === "" && !loading && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-subtle mr-0.5">
                Try
              </span>
              {QUERY_EXAMPLES.map((q) => (
                <button key={q} type="button" onClick={() => setQuery(q)} className={pickChip}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <span className="text-sm font-medium text-foreground">Output format</span>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="outputFormat"
                  value="summary"
                  checked={outputFormat === "summary"}
                  onChange={() => setOutputFormat("summary")}
                  className="w-4 h-4 accent-accent cursor-pointer"
                />
                <span className="text-sm text-foreground">Summary</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="outputFormat"
                  value="detailed"
                  checked={outputFormat === "detailed"}
                  onChange={() => setOutputFormat("detailed")}
                  className="w-4 h-4 accent-accent cursor-pointer"
                />
                <span className="text-sm text-foreground">Detailed</span>
              </label>
            </div>
          </div>

          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showSentiment}
                onChange={() => setShowSentiment(!showSentiment)}
                className="w-4 h-4 accent-accent rounded cursor-pointer"
              />
              <span className="text-sm text-foreground">Show sentiment breakdown</span>
            </label>
          </div>

          <div>
            <label htmlFor="categoryFocus" className="block mb-1.5 text-[13px] font-medium text-foreground">
              Category focus <span className="text-muted font-normal text-xs">(optional)</span>
            </label>
            <input
              id="categoryFocus"
              type="text"
              placeholder="e.g., pricing, reliability"
              value={categoryFocus}
              onChange={(e) => setCategoryFocus(e.target.value)}
              className={inputClass}
              style={AUTOFILL_FIX}
            />
            {!loading && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategoryFocus(categoryFocus === c ? "" : c)}
                    className={`${pickChip} ${
                      categoryFocus === c
                        ? "border-accent/50 bg-indigo-50 text-accent hover:text-accent"
                        : ""
                    }`}
                  >
                    {categoryFocus === c ? "✓" : "+"} {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-indigo-500 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] w-full sm:w-auto ${
              loading ? "ripple-loading" : ""
            }`}
          >
            {loading ? "Analyzing…" : "Run Insight"}
          </button>
          <span className="font-mono text-[11px] text-subtle">POST /api/query</span>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="max-w-2xl p-5 rounded-2xl border border-red-200 bg-red-50 text-red-700 font-body space-y-1">
          <p className="text-[15px] font-semibold">{error}</p>
          <p className="text-sm text-red-500">
            If this keeps happening, the AI service may be unreachable from your network — check
            your connection and try again shortly.
          </p>
        </div>
      )}

      {/* Initial state */}
      {!hasSearched && !loading && !error && (
        <div className="max-w-2xl p-6 rounded-2xl border border-dashed border-zinc-300 bg-white/60 font-body space-y-1">
          <p className="text-[15px] font-semibold text-foreground mb-1">
            Enter a query above to generate insights.
          </p>
          <p className="text-sm text-muted">
            Select output format and optional filters to summarize web &amp; signal clusters.
          </p>
        </div>
      )}

      {/* Summary view */}
      {hasSearched && !loading && !error && outputFormat === "summary" && (
        <div className="max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight">Insight Summary</h2>
            {summary && (
              <button
                onClick={copySummary}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-300 bg-white hover:bg-zinc-50 text-foreground font-mono text-xs transition-colors"
              >
                {copied ? "Copied!" : "Copy summary"}
              </button>
            )}
          </div>
          {summary ? (
            <div className="card rounded-2xl p-6 text-foreground font-body leading-relaxed">
              <p className="text-base whitespace-pre-wrap">{summary}</p>
            </div>
          ) : (
            <div className="card rounded-2xl p-6 font-body">
              <p className="text-muted text-sm">No prose summary available for this query.</p>
            </div>
          )}

          {sources.length > 0 && (
            <div className="card rounded-2xl p-5 space-y-3">
              <h3 className="font-mono text-xs text-muted uppercase tracking-wider">
                Sources ({sources.length})
              </h3>
              <ul className="space-y-3 text-xs font-mono">
                {sources.map((src, idx) => (
                  <li key={idx}>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:text-accent2 hover:underline underline-offset-2 transition-colors block min-w-0 break-all"
                    >
                      {src.url}
                    </a>
                    {src.excerpt && (
                      <blockquote className="mt-1 pl-2.5 border-l-2 border-zinc-200 font-body text-muted italic text-xs leading-relaxed line-clamp-2">
                        {src.excerpt}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Detailed view */}
      {hasSearched && !loading && !error && outputFormat === "detailed" && (
        <section className="space-y-6">
          <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight">
            Detected Issues {issues.length > 0 ? `(${issues.length})` : ""}
          </h2>
          {issues.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {issues.map((issue, idx) => {
                const cardSources = issue.postUrls && issue.postUrls.length > 0 ? issue.postUrls : sources;

                return (
                  <div
                    key={idx}
                    className="card card-hover rounded-xl p-5 flex flex-col justify-between space-y-4"
                  >
                    <div>
                      <h3 className="font-display text-lg font-semibold text-foreground tracking-tight mb-2 leading-snug">
                        {issue.name}
                      </h3>
                      {showSentiment && issue.sentiment && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono my-3">
                          <span className="flex items-center gap-1.5 text-positive">
                            <span className="w-2.5 h-2.5 rounded-full bg-positive inline-block shrink-0" />
                            <span>+{issue.sentiment.positive}</span>
                          </span>
                          <span className="flex items-center gap-1.5 text-negative">
                            <span className="w-2.5 h-2.5 rounded-full bg-negative inline-block shrink-0" />
                            <span>-{issue.sentiment.negative}</span>
                          </span>
                          <span className="flex items-center gap-1.5 text-uncertain">
                            <span className="w-2.5 h-2.5 rounded-full bg-uncertain inline-block shrink-0" />
                            <span>~{issue.sentiment.uncertain}</span>
                          </span>
                        </div>
                      )}
                      {issue.firstSeen && (
                        <p className="text-muted text-xs font-mono mt-1">First seen: {issue.firstSeen}</p>
                      )}
                    </div>

                    {cardSources && cardSources.length > 0 && (
                      <div className="pt-3 border-t border-zinc-100">
                        <h4 className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
                          Sources
                        </h4>
                        <ul className="space-y-2 text-xs font-mono">
                          {cardSources.map((src, urlIdx) => (
                            <li key={urlIdx}>
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:text-accent2 hover:underline underline-offset-2 transition-colors block min-w-0 break-all"
                              >
                                {src.url}
                              </a>
                              {src.excerpt && (
                                <blockquote className="mt-1 pl-2.5 border-l-2 border-zinc-200 font-body text-muted italic text-xs leading-relaxed line-clamp-2">
                                  {src.excerpt}
                                </blockquote>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/60 p-6 font-body">
              <p className="text-[15px] font-semibold text-foreground mb-1">
                No issues detected for this query.
              </p>
              <p className="text-sm text-muted">
                No emergent issue clusters were found. Try adjusting your search terms or category focus.
              </p>
            </div>
          )}

          {sources.length > 0 && (
            <div className="card rounded-2xl p-5 space-y-3">
              <h3 className="font-mono text-xs text-muted uppercase tracking-wider">
                All Query Sources ({sources.length})
              </h3>
              <ul className="space-y-3 text-xs font-mono">
                {sources.map((src, idx) => (
                  <li key={idx}>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:text-accent2 hover:underline underline-offset-2 transition-colors block min-w-0 break-all"
                    >
                      {src.url}
                    </a>
                    {src.excerpt && (
                      <blockquote className="mt-1 pl-2.5 border-l-2 border-zinc-200 font-body text-muted italic text-xs leading-relaxed line-clamp-2">
                        {src.excerpt}
                      </blockquote>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
