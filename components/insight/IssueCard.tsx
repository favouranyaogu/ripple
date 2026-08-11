import React from 'react';

interface Issue {
  name: string;
  sentiment?: { positive: number; negative: number; uncertain: number };
  postUrls: { url: string; excerpt?: string }[];
  firstSeen?: string;
}

interface IssueCardProps {
  issue: Issue;
  showSentiment?: boolean;
}

export default function IssueCard({ issue, showSentiment = true }: IssueCardProps) {
  const { name, sentiment, postUrls, firstSeen } = issue;
  return (
    <div className="rounded bg-surface p-4 shadow border border-surface/50">
      <h3 className="font-display text-lg text-foreground mb-2">{name}</h3>
      {showSentiment && sentiment && (
        <div className="flex space-x-2 text-sm mb-2">
          <span className="text-positive">+{sentiment.positive}</span>
          <span className="text-negative">-{sentiment.negative}</span>
          <span className="text-uncertain">~{sentiment.uncertain}</span>
        </div>
      )}
      {firstSeen && (
        <p className="text-muted text-xs mb-2">First seen: {firstSeen}</p>
      )}
      <ul className="space-y-2 text-xs text-foreground">
        {postUrls.map((post, idx) => (
          <li key={idx}>
            <a href={post.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary block truncate">
              {post.url}
            </a>
            {post.excerpt && (
              <blockquote className="mt-0.5 pl-2 border-l border-muted/30 text-muted italic leading-relaxed line-clamp-2">
                {post.excerpt}
              </blockquote>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
