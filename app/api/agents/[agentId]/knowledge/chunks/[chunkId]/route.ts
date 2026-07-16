import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeCategory } from '@/lib/ai/knowledge/categories';
import { embedText } from '@/lib/server/knowledge/processor';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { agentId: string; chunkId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const body = await request.json();
    const admin = createAdminClient();

    const { data: existing, error: fetchError } = await admin
      .from('kb_chunks')
      .select('metadata')
      .eq('id', params.chunkId)
      .eq('agent_id', params.agentId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: fetchError?.message || 'Чанк не найден' }, { status: 404 });
    }

    const normalizedType = normalizeCategory(body.type);
    const updatedMetadata = {
      ...(existing.metadata || {}),
      ...(body.type ? { category: normalizedType, type: normalizedType } : {}),
      ...(body.title ? { title: String(body.title).trim() } : {}),
    };

    // Handle tag field
    const rawTag = body?.tag ?? null;
    const tag = typeof rawTag === 'string' ? rawTag.trim() : null;
    if (tag === null || tag === '') {
      delete updatedMetadata.tag;
    } else {
      updatedMetadata.tag = tag;
    }

    const updates: Record<string, unknown> = { metadata: updatedMetadata };

    if (typeof body.content === 'string' && body.content.trim()) {
      updates.content = body.content;
      try {
        updates.embedding = await embedText(body.content);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
      }
    }

    const { data, error } = await admin
      .from('kb_chunks')
      .update(updates)
      .eq('id', params.chunkId)
      .eq('agent_id', params.agentId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { agentId: string; chunkId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const admin = createAdminClient();
    const { error } = await admin
      .from('kb_chunks')
      .delete()
      .eq('id', params.chunkId)
      .eq('agent_id', params.agentId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
