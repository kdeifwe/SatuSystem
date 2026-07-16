// app/api/knowledge-base/search/route.ts
// Used by Sandbox and the AI orchestrator to test KB retrieval

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { searchKnowledgeBaseBilingual, formatChunksForPrompt } from '@/lib/knowledge-base/search';

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { agentId, query, topK } = await req.json();
  if (!agentId || !query) {
    return NextResponse.json({ error: 'agentId and query are required' }, { status: 400 });
  }

  try {
    const chunks = await searchKnowledgeBaseBilingual(agentId, query, topK ?? 5);
    return NextResponse.json({
      chunks,
      formatted: formatChunksForPrompt(chunks),
      count: chunks.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}