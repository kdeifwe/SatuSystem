import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeCategory } from '@/lib/ai/knowledge/categories';
import { embedText } from '@/lib/server/knowledge/processor';

const ALLOWED_TYPES = ['product', 'faq', 'procedure', 'contact', 'file', 'other', 'qa', 'contacts'];

function getType(value: unknown) {
  const normalized = normalizeCategory(value);
  return ALLOWED_TYPES.includes(normalized) ? normalized : 'other';
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const search = request.nextUrl.searchParams.get('search') || '';
    const type = request.nextUrl.searchParams.get('type') || 'all';
    const page = Number(request.nextUrl.searchParams.get('page') || '1');
    const limit = Number(request.nextUrl.searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const admin = createAdminClient();
    const query = admin
      .from('kb_chunks')
      .select('*, kb_sources!source_id(title)', { count: 'exact' })
      .eq('agent_id', params.agentId)
      .order('created_at', { ascending: false });

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const allChunks = data || [];
    const filteredChunks = allChunks.filter((chunk: any) => {
      const category = normalizeCategory(chunk.metadata?.category ?? chunk.metadata?.type ?? 'other');
      const matchesType = !type || type === 'all' ? true : category === type;
      const matchesSearch = !search
        ? true
        : [chunk.content, chunk.metadata?.title, chunk.kb_sources?.title].some((value: unknown) =>
            String(value || '').toLowerCase().includes(search.toLowerCase())
          );
      return matchesType && matchesSearch;
    });

    const categoryCounts = allChunks.reduce((acc: Record<string, number>, chunk: any) => {
      const category = normalizeCategory(chunk.metadata?.category ?? chunk.metadata?.type ?? 'other');
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, { product: 0, faq: 0, procedure: 0, contact: 0, file: 0, other: 0 });

    const pagedData = filteredChunks.slice(offset, offset + limit);

    return NextResponse.json({ data: pagedData, total: filteredChunks.length, page, limit, categoryCounts, totalAll: count ?? 0 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const body = await request.json();
    const type = getType(body.type);
    const title = String(body.title || '').trim() || 'Без названия';
    const content = String(body.content || '').trim();
    if (!content) {
      return NextResponse.json({ error: 'content обязателен' }, { status: 400 });
    }

    const embedding = await embedText(content);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('kb_chunks')
      .insert([
        {
          source_id: null,
          agent_id: params.agentId,
          content,
          embedding,
          metadata: {
            category: type,
            type,
            title,
            source_name: 'Manual Input',
          },
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    return errorResponse(err);
  }
}
