import React from "react";

interface Issue {
  name: string;
  sentiment?: { positive: number; negative: number; uncertain: number };
  postUrls: { url: string; excerpt?: string }[];
  firstSeen?: string;
}

export default function IssueCard({ issue }: { issue: Issue }) {
  const { name, sentiment, postUrls, firstSeen } = issue;
  const sourceCount = postUrls.length;

  return (
    <article className="card card-hover rounded-xl p-5 flex flex-col">
      <h3 className="font-display text-lg font-semibold text-foreground tracking-tight leading-snug mb-3">
        {name}
      </h3>

      {sentiment && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono mb-3.5">
          <span className="inline-flex items-center gap-1.5 text-positive">
            <span className="w-1.5 h-1.5 rounded-full bg-positive" />
            +{sentiment.positive} positive
          </span>
          <span className="inline-flex items-center gap-1.5 text-negative">
            <span className="w-1.5 h-1.5 rounded-full bg-negative" />
            -{sentiment.negative} negative
          </span>
          <span className="inline-flex items-center gap-1.5 text-uncertain">
            <span className="w-1.5 h-1.5 rounded-full bg-uncertain" />
            ~{sentiment.uncertain} uncertain
          </span>
        </div>
      )}

      {firstSeen && <p className="text-muted text-xs font-mono mb-3.5">First seen: {firstSeen}</p>}

      {sourceCount > 0 && (
        <div className="pt-4 mt-auto border-t border-zinc-100 space-y-2.5">
          <p className="font-mono text-[11px] text-muted uppercase tracking-wider">
            Sources ({sourceCount})
          </p>
          <ul className="space-y-2.5 text-xs">
            {postUrls.map((post, idx) => (
              <li key={idx}>
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:text-accent2 hover:underline underline-offset-2 transition-colors block min-w-0 break-all font-mono"
                  title={post.url}
                >
                  {post.url}
                </a>
                {post.excerpt && (
                  <blockquote className="mt-1 pl-2.5 border-l-2 border-zinc-200 text-muted leading-relaxed line-clamp-2 font-body">
                    {post.excerpt}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
