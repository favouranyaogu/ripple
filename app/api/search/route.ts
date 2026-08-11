import { NextRequest, NextResponse } from 'next/server';
import { searchWeb } from '@/lib/search';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const query = body?.query || '';

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    const { results } = await searchWeb(query);
    const textResults = results.map(r => `${r.title}\n${r.content}\nSource: ${r.url}`).join('\n\n');
    const sources = results.map(r => r.url);

    return NextResponse.json({
      results: textResults,
      sources,
    });
  } catch (error) {
    console.error('Error in /api/search:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process web search request';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
