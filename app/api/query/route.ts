import { NextRequest, NextResponse } from 'next/server';
import { searchWeb, buildConsumerQuery } from '@/lib/search';
import { clusterPosts, generateProseSummary, PostSource } from '@/lib/ai';

let lastQueryTime = 0;
const COOLDOWN_MS = 15000;

interface QueryRequestBody {
  query: string;
  options?: {
    platforms?: string[];
    outputFormat?: "summary" | "detailed";
    showSentimentBreakdown?: boolean;
    categoryFocus?: string;
  };
}

interface IssueResult {
  name: string;
  postUrls: PostSource[];
  sentiment?: { positive: number; negative: number; uncertain: number };
}

/**
 * POST /api/query
 * Body: {
 *   query: string,
 *   options?: {
 *     platforms?: string[];
 *     outputFormat?: "summary" | "detailed";
 *     showSentimentBreakdown?: boolean;
 *     categoryFocus?: string;
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  const now = Date.now();
  if (now - lastQueryTime < COOLDOWN_MS) {
    return NextResponse.json(
      { error: "Please wait a moment before running another scan/query." },
      { status: 429 }
    );
  }
  lastQueryTime = now;

  // Parse JSON body safely
  let body: QueryRequestBody;
  try {
    body = (await request.json()) as QueryRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { query, options = {} } = body;
  if (!query) {
    return NextResponse.json({ error: 'Missing required field: query' }, { status: 400 });
  }

  const {
    platforms,
    showSentimentBreakdown = true,
    categoryFocus,
  } = options;

  // Build search string – consumer query tuning
  const searchQuery = buildConsumerQuery(query, categoryFocus);

  // Execute Tavily web search
  const { results: searchResults } = await searchWeb(searchQuery);

  // Convert search results to the post shape expected by clusterPosts
  const posts = searchResults
    .map(r => {
      let platform = "web";
      const url = r.url;
      if (url.includes('reddit.com')) platform = 'reddit';
      else if (url.includes('x.com') || url.includes('twitter.com')) platform = 'x';
      else if (url.includes('youtube.com')) platform = 'youtube';
      else if (url.includes('github.com')) platform = 'github';

      // Filter by allowed platforms if provided
      // Note: If 'web' is included in platforms, accept all web search results
      if (platforms && platforms.length > 0 && !platforms.includes('web') && !platforms.includes(platform)) {
        return null; // filter out only when 'web' is not selected and specific platform doesn't match
      }

      return {
        content: `${r.title}\n${r.content}`,
        platform,
        url,
      };
    })
    .filter((p): p is { content: string; platform: string; url: string } => p !== null);

  console.log(`[/api/query] Search returned ${searchResults.length} results, ${posts.length} posts passed platform filter.`);

  // Cluster posts using Gemini
  const clusterResult = await clusterPosts(posts, {
    topic: query,
    community: "general",
    project: categoryFocus || "general",
  });

  // Generate detailed issues list
  const detailedResults: IssueResult[] = (clusterResult?.issues || []).map(issue => {
    const base: IssueResult = {
      name: issue.name || 'Unnamed Issue',
      postUrls: issue.postUrls || [],
    };
    if (showSentimentBreakdown && issue.sentiment) {
      base.sentiment = issue.sentiment;
    }
    return base;
  });

  // Gather source URLs for the top-level sources list
  const sources = searchResults.map(r => ({ url: r.url, excerpt: r.content }));


  // Generate AI prose summary
  const summaryText = await generateProseSummary(posts, clusterResult?.issues || [], {
    topic: query,
    community: "general",
    project: categoryFocus || "general",
  });

  return NextResponse.json({
    query,
    detailedResults,
    summaryText,
    sources,
  });
}

