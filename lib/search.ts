import { tavily } from '@tavily/core';

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

export async function searchWeb(query: string): Promise<{ results: TavilyResult[] }> {
  const response = await tvly.search(query);
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

