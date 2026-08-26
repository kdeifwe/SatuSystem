import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processSource, embedText } from '@/lib/server/knowledge/processor';
import MEDIA_CATEGORIES from '@/lib/media/categories';

const ALLOWED_TYPES = ['product', 'qa', 'procedure', 'contacts', 'file', 'other'];

function getType(value: unknown) {
  const type = String(value || '').trim().toLowerCase();
  return ALLOWED_TYPES.includes(type) ? type : 'other';
}

function formatDateTitle(prefix: string) {
  return `${prefix} - ${new Date().toISOString().slice(0, 10)}`;
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

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('kb_sources')
      .select('id, title, type, status, file_size, metadata, created_at, inline_in_prompt')
      .eq('agent_id', params.agentId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sources = await Promise.all(
      (data || []).map(async (source: any) => {
        const { count, error: countError } = await admin
          .from('kb_chunks')
          .select('id', { count: 'exact' })
          .eq('source_id', source.id);

        return {
          ...source,
          chunks_count: countError ? 0 : count ?? 0,
        };
      })
    );

    return NextResponse.json({ sources });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const admin = createAdminClient();
    const contentType = request.headers.get('content-type') || '';
    let file: File | null = null;
    let url = '';
    let content = '';
    let title = '';
    let type = 'other';
    let useAI = true;
    let inlineInPrompt = false;
    let mediaCategory: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      file = formData.get('file') as File | null;
      url = String(formData.get('url') || '').trim();
      content = String(formData.get('content') || '').trim();
      title = String(formData.get('title') || '').trim();
      type = getType(formData.get('type'));
      useAI = String(formData.get('useAI') || 'true') !== 'false';
      inlineInPrompt = String(formData.get('inlineInPrompt') || 'false') === 'true';
      mediaCategory = String(formData.get('media_category') || '').trim() || null;
    } else {
      const body = await request.json();
      file = null;
      url = String(body.url || '').trim();
      content = String(body.content || '').trim();
      title = String(body.title || '').trim();
      type = getType(body.type);
      useAI = body.useAI !== false;
      inlineInPrompt = body.inlineInPrompt === true;
      mediaCategory = String(body.media_category || '').trim() || null;
    }

    if (mediaCategory && !MEDIA_CATEGORIES.some((c) => c.id === mediaCategory)) {
      return NextResponse.json({ error: `Invalid media_category: ${mediaCategory}` }, { status: 400 });
    }

    if (file) {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const sourceTitle = `${file.name} - ${new Date().toISOString().slice(0, 10)}`;
      const { data: sourceData, error: insertError } = await admin
        .from('kb_sources')
        .insert([
          {
            agent_id: params.agentId,
            type: 'file',
            title: sourceTitle,
            status: 'processing',
            file_size: file.size,
            metadata: {
              storage_path: `${params.agentId}/${sourceTitle}/${sanitizedName}`,
              use_ai: useAI,
              mime_type: file.type,
              ...(mediaCategory ? { media_category: mediaCategory } : {}),
            },
          },
        ])
        .select('id')
        .single();

      if (insertError || !sourceData?.id) {
        return NextResponse.json({ error: insertError?.message || 'Не удалось создать источник' }, { status: 500 });
      }

      const sourceId = sourceData.id;
      const storagePath = `${params.agentId}/${sourceId}/${sanitizedName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadError } = await admin.storage
        .from('kb-files')
        .upload(storagePath, buffer, {
          contentType: file.type,
        });

      if (uploadError) {
        await admin.from('kb_sources').delete().eq('id', sourceId);
        return NextResponse.json({ error: uploadError.message }, { status: 500 });
      }

      await admin
        .from('kb_sources')
        .update({
          file_path: storagePath,
          metadata: {
            storage_path: storagePath,
            use_ai: useAI,
            mime_type: file.type,
            ...(mediaCategory ? { media_category: mediaCategory } : {}),
          },
        })
        .eq('id', sourceId);

      setImmediate(() => processSource(sourceId, params.agentId, useAI).catch((err) => console.error('[processSource] failed:', err)));
      return NextResponse.json({ sourceId, status: 'processing' });
    }

    if (url) {
      const normalizedUrl = url;
      const response = await fetch(normalizedUrl);
      if (!response.ok) {
        return NextResponse.json({ error: `Не удалось загрузить URL: ${response.status}` }, { status: 500 });
      }
      const html = await response.text();
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const sourceTitle = title || formatDateTitle('Website Content');

      const { data: sourceData, error: insertError } = await admin
        .from('kb_sources')
        .insert([
          {
            agent_id: params.agentId,
            type: 'website',
            title: sourceTitle,
            status: 'processing',
            raw_content: text,
            metadata: {
              url: normalizedUrl,
              use_ai: useAI,
              ...(mediaCategory ? { media_category: mediaCategory } : {}),
            },
          },
        ])
        .select('id')
        .single();

      if (insertError || !sourceData?.id) {
        return NextResponse.json({ error: insertError?.message || 'Не удалось создать источник сайта' }, { status: 500 });
      }

      const sourceId = sourceData.id;
      setImmediate(() => processSource(sourceId, params.agentId, useAI).catch((err) => console.error('[processSource] failed:', err)));
      return NextResponse.json({ sourceId, status: 'processing' });
    }

    if (content) {
      const sourceTitle = title || formatDateTitle('Manual Content');
      const sourceType = type || 'other';
      const { data: sourceData, error: sourceError } = await admin
        .from('kb_sources')
        .insert([
          {
            agent_id: params.agentId,
            type: sourceType,
            title: sourceTitle,
            status: 'processing',
            raw_content: content,
            inline_in_prompt: inlineInPrompt,
            metadata: {
              type: sourceType,
              title: sourceTitle,
              source_name: sourceTitle,
              ...(mediaCategory ? { media_category: mediaCategory } : {}),
            },
          },
        ])
        .select('id')
        .single();

      if (sourceError || !sourceData?.id) {
        return NextResponse.json({ error: sourceError?.message || 'Не удалось создать источник вручную' }, { status: 500 });
      }

      const sourceId = sourceData.id;
      const vector = await embedText(content);
      const { error: chunkError } = await admin.from('kb_chunks').insert([
        {
          source_id: sourceId,
          agent_id: params.agentId,
          content,
          embedding: vector,
          metadata: {
            type: sourceType,
            title: sourceTitle,
            source_name: sourceTitle,
          },
        },
      ]);

      if (chunkError) {
        console.error('[KB] Failed to insert manual chunk:', chunkError);
        return NextResponse.json({ error: chunkError.message }, { status: 500 });
      }

      await admin.from('kb_sources').update({
        status: 'done',
        metadata: {
          type: sourceType,
          title: sourceTitle,
          source_name: sourceTitle,
          processed_at: new Date().toISOString(),
          chunks_count: 1,
        },
      }).eq('id', sourceId);

      return NextResponse.json({ sourceId, status: 'done' });
    }

    return NextResponse.json({ error: 'Неверный запрос. Переданы не file, не url и не content.' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
