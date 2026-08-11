import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Network-layer failure codes from Node/undici indicating a transient egress blip
// (connect timeouts, DNS failures, socket resets). API-level errors (invalid key,
// bad request, quota) are deliberately NOT here so they surface immediately.
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'ENETDOWN',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
]);

function isNetworkLayerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const chain: { code?: unknown; message?: unknown }[] = [err];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error && chain.length < 8) {
    chain.push(cause);
    cause = (cause as { cause?: unknown }).cause;
  }
  if (chain.some(c => typeof c.code === 'string' && NETWORK_ERROR_CODES.has(c.code))) {
    return true;
  }
  // undici/Node surfaces fetch failures as "TypeError: fetch failed" with a nested cause
  const messages = chain
    .map(c => (typeof c.message === 'string' ? c.message : ''))
    .join(' | ');
  return /fetch failed|connect .*timed ?out|socket hang up|getaddrinfo|network is unreachable/i.test(messages);
}

const GEMINI_MAX_ATTEMPTS = 3;
// Backoff delays between retries (ms), with ±30% jitter applied per attempt.
const GEMINI_RETRY_DELAYS_MS = [2000, 6000];
// Per-attempt timeout: a hung TLS connection shouldn't stall a scan for minutes.
const GEMINI_ATTEMPT_TIMEOUT_MS = 25000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Gemini request timed out after ${ms}ms`) as Error & { code?: string };
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function jitteredDelay(index: number): Promise<void> {
  const base = GEMINI_RETRY_DELAYS_MS[Math.min(index, GEMINI_RETRY_DELAYS_MS.length - 1)] ?? 4000;
  const jitter = base * 0.3 * (Math.random() * 2 - 1);
  return new Promise(resolve => setTimeout(resolve, Math.max(250, base + jitter)));
}

/**
 * Wraps a Gemini call with up to 3 attempts (2s / 6s jittered backoff) that
 * only retries on transient network-layer failures — socket resets, timeouts,
 * DNS blips. Real API errors (invalid key, bad request, quota) propagate
 * immediately and are not masked. Each attempt is capped at 25s so a wedged
 * connection fails fast and the next attempt starts promptly.
 */
async function generateContentWithRetry(
  request: Parameters<typeof ai.models.generateContent>[0]
): Promise<Awaited<ReturnType<typeof ai.models.generateContent>>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(ai.models.generateContent(request), GEMINI_ATTEMPT_TIMEOUT_MS);
    } catch (err) {
      lastError = err;
      const retriable = isNetworkLayerError(err);
      console.warn(
        `[ai] Gemini ${retriable ? 'network error' : 'error'} (attempt ${attempt}/${GEMINI_MAX_ATTEMPTS}):`,
        err
      );
      if (!retriable || attempt === GEMINI_MAX_ATTEMPTS) {
        if (retriable) {
          // Surface a human-readable reason instead of undici's raw "fetch failed".
          const wrapped = new Error(
            `AI service unreachable after ${GEMINI_MAX_ATTEMPTS} attempts — check your network connection and try again.`
          ) as Error & { cause?: unknown };
          wrapped.cause = err;
          throw wrapped;
        }
        throw err;
      }
      await jitteredDelay(attempt - 1);
    }
  }
  throw lastError;
}

export interface PostItem {
  content: string;
  platform: string;
  url: string;
}

export interface ClusterContext {
  topic: string;
  community: string;
  project: string;
}

export interface PostSource {
  url: string;
  excerpt: string;
}

export interface IssueCluster {
  name: string;
  sentiment: {
    positive: number;
    negative: number;
    uncertain: number;
  };
  postUrls: PostSource[];
}

export interface ClusterResult {
  issues: IssueCluster[];
}

export interface ExistingIssue {
  id: string;
  name: string;
}

export interface NewIssue {
  name: string;
}

export interface DuplicateFlag {
  newIssueName: string;
  existingIssueId: string;
  existingIssueName: string;
  reason: string;
}


/**
 * Groups posts into emergent issues, names each issue, classifies sentiment,
 * and returns structured JSON.
 */
export async function clusterPosts(
  posts: PostItem[],
  context: ClusterContext
): Promise<ClusterResult> {
  console.log(`[clusterPosts] Received ${posts.length} posts to cluster for topic: "${context.topic}"`);

  if (!posts || posts.length === 0) {
    console.log('[clusterPosts] Posts array is empty, returning empty issues array');
    return { issues: [] };
  }

  // Build a URL→excerpt lookup so we can enrich after parsing
  const urlToExcerpt = new Map<string, string>(posts.map(p => [p.url, p.content]));

  const prompt = `You are an expert analyst. Analyze the following posts for project "${context.project}", community "${context.community}", and topic "${context.topic}".
  Group the posts into emergent issues, naming each distinct entity (e.g., platform, brand, product) as its own issue, even if overall sentiment is similar. Only merge posts when they discuss the same specific entity or complaint/theme. Name each issue, classify sentiment as Positive/Negative/Uncertain, and return structured JSON matching this format:
{
  "issues": [
    {
      "name": "Issue Name",
      "sentiment": {
        "positive": 0,
        "negative": 0,
        "uncertain": 0
      },
      "postUrls": ["http://example.com/1"]
    }
  ]
}

Posts to analyze:
${JSON.stringify(posts, null, 2)}`;

  const response = await generateContentWithRetry({
    model: 'gemini-flash-lite-latest',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  const responseText = response.text || '{"issues":[]}';
  console.log('[clusterPosts] Raw Gemini responseText:', responseText);

  try {
    // The model returns postUrls as plain strings; we'll convert them to PostSource after normalisation
    const rawParsed = JSON.parse(responseText) as {
      issues: {
        name: string;
        sentiment: { positive: number; negative: number; uncertain?: number; unordered?: number };
        postUrls: string[];
      }[];
    };
    if (rawParsed && Array.isArray(rawParsed.issues)) {
      // Normalize sentiment keys and enrich postUrls with excerpts
      const parsed: ClusterResult = {
        issues: rawParsed.issues.map(issue => {
          if (issue.sentiment && (issue.sentiment as { unordered?: number }).unordered !== undefined) {
            issue.sentiment.uncertain = (issue.sentiment as { unordered?: number }).unordered;
            delete (issue.sentiment as { unordered?: number }).unordered;
          }
          const sentiment = issue.sentiment
            ? {
                positive: issue.sentiment.positive ?? 0,
                negative: issue.sentiment.negative ?? 0,
                uncertain: issue.sentiment.uncertain ?? 0,
              }
            : { positive: 0, negative: 0, uncertain: 0 };

          // Convert plain URL strings → { url, excerpt } using the lookup map
          const postUrls = (issue.postUrls || []).map(url => ({
            url,
            excerpt: urlToExcerpt.get(url) ?? '',
          }));

          return { name: issue.name, sentiment, postUrls };
        }),
      };
      console.log('[clusterPosts] Final parsed issues count:', parsed.issues.length);
      console.log('[clusterPosts] Raw output issues:', JSON.stringify(parsed.issues, null, 2));
      return parsed;
    } else {
      console.warn('[clusterPosts] Parsed result does not contain issues array:', rawParsed);
      return { issues: [] };
    }
  } catch (err) {
    console.error('[clusterPosts] JSON parse error:', err, 'Raw text:', responseText);
    return { issues: [] };
  }
}

/**
 * Generates an executive AI-synthesized prose summary for a query context and findings.
 */
export async function generateProseSummary(
  posts: PostItem[],
  issues: IssueCluster[],
  context: ClusterContext
): Promise<string> {
  if (posts.length === 0 && issues.length === 0) {
    return `No public discussions or operational signals were found for topic "${context.topic}".`;
  }

  const prompt = `You are an expert intelligence analyst. Synthesize a clear, cohesive prose summary (2-3 paragraphs) analyzing consumer sentiment, key emergent themes, user complaints, and operational findings for topic "${context.topic}" (focus area: "${context.project}").

Identified Issue Clusters:
${JSON.stringify(issues, null, 2)}

Web Discussion Signals:
${JSON.stringify(posts, null, 2)}

Write readable, informative prose paragraphs summarizing the overall situation, key takeaways, and consumer themes. Do not use raw JSON or plain bullet templates.`;

  try {
    const response = await generateContentWithRetry({
      model: 'gemini-flash-lite-latest',
      contents: prompt,
    });
    return response.text || (issues.length > 0 ? `Key themes detected: ${issues.map(i => i.name).join(', ')}` : `Summary complete for "${context.topic}".`);
  } catch (e) {
    console.error('[generateProseSummary] Error generating prose summary:', e);
    if (issues.length > 0) {
      return `Key themes detected across signals: ${issues.map(i => i.name).join(', ')}.`;
    }
    return `Analysis completed for "${context.topic}".`;
  }
}

/**
 * Identifies which new issue names look like duplicates of existing issues.
 * Returns duplicates for manual user confirmation (no auto-merge).
 */
export async function flagDuplicateIssues(
  existingIssues: ExistingIssue[],
  newIssues: NewIssue[]
): Promise<{ duplicates: DuplicateFlag[] }> {
  const prompt = `Compare new issue names against existing issues. Identify which new issue names look like duplicates or highly similar to existing ones.
Do not auto-merge. Return structured JSON for manual user confirmation.

Existing Issues:
${JSON.stringify(existingIssues, null, 2)}

New Issues:
${JSON.stringify(newIssues, null, 2)}

Return JSON matching this exact structure:
{
  "duplicates": [
    {
      "newIssueName": "New Issue Name",
      "existingIssueId": "existing-id",
      "existingIssueName": "Existing Issue Name",
      "reason": "Brief explanation"
    }
  ]
}`;

  const response = await generateContentWithRetry({
    model: 'gemini-flash-lite-latest',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  });

  const responseText = response.text || '{"duplicates":[]}';
  try {
    return JSON.parse(responseText) as { duplicates: DuplicateFlag[] };
  } catch {
    return { duplicates: [] };
  }
}

export async function callAI(prompt: string): Promise<string> {
  const response = await generateContentWithRetry({
    model: 'gemini-flash-lite-latest',
    contents: prompt,
  });
  return response.text || '';
}
