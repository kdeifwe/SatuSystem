import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { searchKnowledgeBaseBilingual, formatChunksForPrompt } from '@/lib/knowledge-base/search';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const { agentId, query, topK } = await req.json();
  if (!agentId || !query) return NextResponse.json({ error: 'agentId и query обязательны' }, { status: 400 });

  try {
    const chunks = await searchKnowledgeBaseBilingual(agentId, query, topK ?? 10);
    const formatted = formatChunksForPrompt(chunks);
    return NextResponse.json({ chunks, formatted, count: chunks.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
