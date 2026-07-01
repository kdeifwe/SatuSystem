// app/api/knowledge-base/process/route.ts
// Creates kb_source for manual text, website URL, or Q&A pairs, then triggers processing

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { processKBSource } from '@/lib/knowledge-base/processor';

type SourceType = 'manual' | 'website' | 'qa';

interface ManualPayload {
  type: 'manual';
  agentId: string;
  title: string;
  content: string;
}

interface WebsitePayload {
  type: 'website';
  agentId: string;
  title?: string;
  url: string;
}

interface QAPayload {
  type: 'qa';
  agentId: string;
  title: string;
  pairs: { question: string; answer: string }[];
}

type Payload = ManualPayload | WebsitePayload | QAPayload;

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as Payload;

  if (!body.agentId || !body.type) {
    return NextResponse.json({ error: 'agentId and type are required' }, { status: 400 });
  }

  // Build the insert payload based on type
  let insertData: Record<string, unknown> = { agent_id: body.agentId, type: body.type, status: 'pending' };

  switch (body.type) {
    case 'manual':
      if (!body.content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 });
      insertData = {
        ...insertData,
        title: body.title || 'Текстовый блок',
        raw_content: body.content,
      };
      break;

    case 'website':
      if (!body.url?.trim()) return NextResponse.json({ error: 'url is required' }, { status: 400 });
      insertData = {
        ...insertData,
        title: body.title || body.url,
        metadata: { url: body.url },
      };
      break;

    case 'qa':
      if (!body.pairs?.length) return NextResponse.json({ error: 'pairs are required' }, { status: 400 });
      insertData = {
        ...insertData,
        title: body.title || 'Вопросы и ответы',
        metadata: { pairs: body.pairs },
      };
      break;

    default:
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const { data: source, error } = await supabase
    .from('kb_sources')
    .insert(insertData)
    .select()
    .single();

  if (error || !source) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create source' }, { status: 500 });
  }

  // Fire-and-forget (for prod: use Edge Function trigger)
  processKBSource(source.id).catch((err) =>
    console.error(`KB processing failed for source ${source.id}:`, err),
  );

  return NextResponse.json({ sourceId: source.id, status: 'processing' });
}