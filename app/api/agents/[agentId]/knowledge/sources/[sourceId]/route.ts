import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { agentId: string; sourceId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const admin = createAdminClient();
    const { data: source, error: sourceError } = await admin
      .from('kb_sources')
      .select('file_path, metadata')
      .eq('id', params.sourceId)
      .eq('agent_id', params.agentId)
      .single();

    if (sourceError || !source) {
      return NextResponse.json({ error: sourceError?.message || 'Источник не найден' }, { status: 404 });
    }

    const { error: chunksError } = await admin
      .from('kb_chunks')
      .delete()
      .eq('source_id', params.sourceId)
      .eq('agent_id', params.agentId);

    if (chunksError) {
      console.error('[KB] Failed to delete chunks for source:', params.sourceId, chunksError);
      return NextResponse.json({ error: 'Ошибка удаления чанков' }, { status: 500 });
    }

    const storagePath = source.metadata?.storage_path || source.file_path;
    if (storagePath) {
      const { error: storageError } = await admin.storage.from('kb-files').remove([storagePath]);
      if (storageError) {
        console.warn('[KB] Failed to delete file from storage:', params.sourceId, storageError);
      }
    }

    const { error } = await admin
      .from('kb_sources')
      .delete()
      .eq('id', params.sourceId)
      .eq('agent_id', params.agentId);

    if (error) {
      console.error('[KB] Failed to delete source record:', params.sourceId, error);
      return NextResponse.json({ error: 'Ошибка удаления записи' }, { status: 500 });
    }

    console.log('[KB] Source deleted successfully:', params.sourceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { agentId: string; sourceId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const admin = createAdminClient();
    const body = await request.json();
    const rawTag = body?.tag ?? (body?.metadata && body.metadata.tag) ?? null;
    const tag = typeof rawTag === 'string' ? rawTag.trim() : null;

    // Fetch source and verify ownership
    const { data: source, error: fetchError } = await admin
      .from('kb_sources')
      .select('*')
      .eq('id', params.sourceId)
      .eq('agent_id', params.agentId)
      .single();

    if (fetchError || !source) {
      return NextResponse.json({ error: fetchError?.message || 'Источник не найден' }, { status: 404 });
    }

    // Merge metadata on source
    const nextSourceMetadata = {
      ...(source.metadata || {}),
    };
    if (tag === null || tag === '') {
      delete nextSourceMetadata.tag;
    } else {
      nextSourceMetadata.tag = tag;
    }

    const { error: updateError } = await admin
      .from('kb_sources')
      .update({ metadata: nextSourceMetadata })
      .eq('id', params.sourceId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Backfill: update all chunks for this source to include tag in metadata
    if (tag !== null && tag !== '') {
      const { data: chunks, error: chunksError } = await admin
        .from('kb_chunks')
        .select('id,metadata')
        .eq('source_id', params.sourceId);

      if (chunksError) {
        console.error('[KB] Failed to fetch chunks for backfill:', chunksError);
      } else if (Array.isArray(chunks) && chunks.length) {
        // update in parallel in small batches
        const batchSize = 20;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          await Promise.all(
            batch.map((c: any) => {
              const nextMeta = { ...(c.metadata || {}), tag };
              return admin.from('kb_chunks').update({ metadata: nextMeta }).eq('id', c.id);
            })
          );
        }
      }
    } else {
      // If tag was cleared, remove tag key from chunk metadata
      const { data: chunks, error: chunksError } = await admin
        .from('kb_chunks')
        .select('id,metadata')
        .eq('source_id', params.sourceId);

      if (!chunksError && Array.isArray(chunks) && chunks.length) {
        const batchSize = 20;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          await Promise.all(
            batch.map((c: any) => {
              const nextMeta = { ...(c.metadata || {}) };
              delete nextMeta.tag;
              return admin.from('kb_chunks').update({ metadata: nextMeta }).eq('id', c.id);
            })
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
