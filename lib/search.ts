import { tavily } from '@tavily/core';
import type { SearchWindow } from '@/lib/time';

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY || '' });

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
}

export function buildConsumerQuery(topic: string, community?: string, project?: string): string {
  const parts = [topic, community, project].filter((p): p is string => Boolean(p && p.trim()));
  const baseQuery = parts.map(p => p.trim()).join(' ');
  const modifiers = 'reviews OR complaints OR experience OR forum OR reddit';
  return baseQuery ? `${baseQuery} ${modifiers}` : modifiers;
}

/**
 * Searches the web via Tavily. `window` (optional) limits results to content
 * published within the last N days (Tavily caps this at 30).
 */
export async function searchWeb(query: string, window?: SearchWindow): Promise<{ results: TavilyResult[] }> {
  const days = window?.days;
  const response = await tvly.search(
    query,
    days && days > 0 ? { days: Math.min(days, 30) } : undefined
  );
  const results = ((response.results || []) as TavilyRawResult[]).map((r) => {
    const raw = r.content || '';
    const content = raw.length > 200 ? raw.slice(0, 200).trimEnd() + '…' : raw;
    return {
      title: r.title || '',
      url: r.url || '',
      content,
    };
  });

  return { results };
}

