import Link from "next/link";
import XBudgetBadge from "@/components/XBudgetBadge";
import ServiceHealth from "@/components/ServiceHealth";

const FEATURES = [
  {
    title: "Multi-platform listening",
    description:
      "One scan spans Tavily web search, X, Reddit, and Bluesky — so signals from every corner of the conversation are captured.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    title: "AI issue clustering",
    description:
      "Gemini groups related posts into emergent issues, deduplicates against what you've already tracked, and keeps your queue clean.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v5.625" />
      </svg>
    ),
  },
  {
    title: "Sentiment at a glance",
    description:
      "Every issue carries a positive / negative / uncertain breakdown, so you can tell a quiet annoyance from an escalating fire.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
      </svg>
    ),
  },
  {
    title: "Budget-aware by design",
    description:
      "X reads are metered against a daily budget with a hard cap. Spend is tracked per day, so cost never surprises you.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

// Live per-service health lives in <ServiceHealth /> (fetches /api/health).

const STEPS = [
  { n: "01", title: "Scan", text: "Pick a topic and channels — or batch a whole list." },
  { n: "02", title: "Cluster", text: "AI groups the noise into distinct, deduplicated issues." },
  { n: "03", title: "Track", text: "Spend, sentiment, and history — all in one place." },
];

export default function Home() {
  return (
    <div className="space-y-24 sm:space-y-36 pb-10">
      {/* Hero — editorial, left-aligned */}
      <section className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-16 items-center pt-10 sm:pt-16">
        <div className="space-y-8">
          <p
            className="rise inline-flex items-center gap-2.5 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-muted shadow-card"
            style={{ animationDelay: "0ms" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            AI signal monitoring
          </p>

          <h1
            className="rise font-display text-[3.25rem] leading-[0.95] sm:text-7xl lg:text-[5.25rem] font-semibold tracking-tight text-foreground"
            style={{ animationDelay: "70ms" }}
          >
            Watch the noise.
            <br />
            Catch the <span className="text-gradient">signal</span>.
          </h1>

          <p
            className="rise text-base sm:text-lg text-muted leading-relaxed max-w-xl"
            style={{ animationDelay: "140ms" }}
          >
            Ripple listens across the open web, X, Reddit, and Bluesky — then uses AI to surface
            emerging complaints, bugs, and sentiment shifts before they snowball.
          </p>

          <div
            className="rise flex flex-wrap items-center gap-3 pt-1"
            style={{ animationDelay: "210ms" }}
          >
            <Link
              href="/monitor"
              className="px-6 py-3 rounded-lg bg-accent hover:bg-indigo-500 text-white font-semibold transition-all active:scale-[0.98]"
            >
              Open Monitor
            </Link>
            <Link
              href="/insight"
              className="px-6 py-3 rounded-lg border border-zinc-300 bg-white text-foreground font-semibold hover:bg-zinc-50 transition-all active:scale-[0.98]"
            >
              Generate Insight
            </Link>
          </div>

          <div
            className="rise flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 font-mono text-[11px] text-subtle"
            style={{ animationDelay: "280ms" }}
          >
            <span>4 platforms</span>
            <span className="w-1 h-1 rounded-full bg-zinc-300" />
            <span>AI clustering</span>
            <span className="w-1 h-1 rounded-full bg-zinc-300" />
            <span>metered X reads</span>
          </div>
        </div>

        {/* Right column: live status stack */}
        <div className="space-y-4">
          <div
            className="rise card rounded-2xl p-6 space-y-4"
            style={{ animationDelay: "120ms" }}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
                Service health
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
                live · 60s
              </span>
            </div>
            <ServiceHealth />
          </div>

          <div className="rise" style={{ animationDelay: "180ms" }}>
            <XBudgetBadge className="w-full" />
          </div>

          <div
            className="rise card rounded-2xl p-6"
            style={{ animationDelay: "240ms" }}
          >
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground mb-4">
              How it works
            </h2>
            <ol className="space-y-3.5">
              {STEPS.map((s) => (
                <li key={s.n} className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-subtle">{s.n}</span>
                  <span className="text-sm font-medium text-foreground w-20 shrink-0">{s.title}</span>
                  <span className="text-sm text-muted leading-snug">{s.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* [01] Features — editorial stacked rows */}
      <section className="space-y-8">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-subtle">[01]</span>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            What Ripple does
          </h2>
        </div>
        <div className="divide-y divide-zinc-200/80 border-y border-zinc-200/80">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className="grid sm:grid-cols-[64px_1.1fr_1.6fr] gap-4 sm:gap-8 py-8 sm:py-10"
            >
              <span className="font-mono text-xs text-subtle pt-1">0{i + 1}</span>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-zinc-100 text-accent flex items-center justify-center shrink-0">
                  {f.icon}
                </div>
                <h3 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-foreground leading-snug">
                  {f.title}
                </h3>
              </div>
              <p className="text-[15px] text-muted leading-relaxed sm:pt-1">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* [02] Explore */}
      <section className="space-y-8">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-xs text-subtle">[02]</span>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            Explore
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Link
            href="/monitor"
            className="group card card-hover rounded-2xl p-8 sm:p-10 flex flex-col justify-between gap-10 hover:-translate-y-0.5 transition-transform"
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-subtle uppercase tracking-widest">
                  01 / Monitor
                </span>
                <div className="w-9 h-9 rounded-lg bg-zinc-100 text-accent flex items-center justify-center group-hover:bg-zinc-200 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Monitor
                </h3>
                <p className="text-[15px] text-muted leading-relaxed">
                  Run multi-platform scans, watch issues emerge and cluster in real time, and keep an
                  eye on X API spend.
                </p>
              </div>
            </div>
            <div className="pt-5 border-t border-zinc-100 flex items-center justify-between text-xs font-mono text-muted group-hover:text-accent transition-colors">
              <span>Open Signal Monitor</span>
              <span>&rarr;</span>
            </div>
          </Link>

          <Link
            href="/insight"
            className="group card card-hover rounded-2xl p-8 sm:p-10 flex flex-col justify-between gap-10 hover:-translate-y-0.5 transition-transform"
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-subtle uppercase tracking-widest">
                  02 / Insight
                </span>
                <div className="w-9 h-9 rounded-lg bg-zinc-100 text-accent flex items-center justify-center group-hover:bg-zinc-200 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Insight
                </h3>
                <p className="text-[15px] text-muted leading-relaxed">
                  Ask targeted questions and get AI-synthesized summaries with sentiment breakdowns
                  and source trails.
                </p>
              </div>
            </div>
            <div className="pt-5 border-t border-zinc-100 flex items-center justify-between text-xs font-mono text-muted group-hover:text-accent transition-colors">
              <span>Open Intelligence Desk</span>
              <span>&rarr;</span>
            </div>
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="card rounded-2xl p-10 sm:p-16 text-center space-y-5 border-accent/20">
        <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.02] text-foreground">
          Start listening today
        </h2>
        <p className="text-muted max-w-lg mx-auto text-[15px] leading-relaxed">
          Point Ripple at your brand, product, or market and let it surface the signal hidden in the
          noise.
        </p>
        <div className="pt-3">
          <Link
            href="/monitor"
            className="inline-block px-6 py-3 rounded-lg bg-accent hover:bg-indigo-500 text-white font-semibold transition-all active:scale-[0.98]"
          >
            Launch Monitor
          </Link>
        </div>
      </section>
    </div>
  );
}
