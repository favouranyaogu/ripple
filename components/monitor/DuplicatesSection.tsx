import React from "react";

interface Duplicate {
  newIssueName: string;
  existingIssueId: string;
  existingIssueName: string;
  reason: string;
}

export default function DuplicatesSection({ duplicates }: { duplicates: Duplicate[] }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl font-semibold text-foreground tracking-tight">
          Possible Duplicates{" "}
          <span className="font-mono text-sm font-normal text-subtle">({duplicates.length})</span>
        </h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-uncertain">
          <span className="w-1.5 h-1.5 rounded-full bg-uncertain" />
          review suggested
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {duplicates.map((dup, idx) => (
          <div key={idx} className="card rounded-xl p-5">
            <h3 className="font-display text-lg font-semibold text-foreground tracking-tight leading-snug mb-2">
              {dup.newIssueName}
            </h3>
            <p className="text-sm text-muted mb-2 font-body">
              May be duplicate of{" "}
              <span className="font-medium text-foreground">{dup.existingIssueName}</span>
            </p>
            <div className="inline-flex items-start gap-1.5 text-xs text-muted font-body">
              <svg
                className="w-3.5 h-3.5 mt-0.5 shrink-0 text-uncertain"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                />
              </svg>
              <span>{dup.reason}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
