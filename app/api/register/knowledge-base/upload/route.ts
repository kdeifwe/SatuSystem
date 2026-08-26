// app/api/knowledge-base/upload/route.ts
// Accepts file upload → stores in Supabase Storage → creates kb_source → triggers processing

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { extractTextFromBuffer } from '@/lib/knowledge-base/extractor';
import MEDIA_CATEGORIES from '@/lib/media/categories';
import { processKBSource } from '@/lib/knowledge-base/processor';

const MAX_FILE_SIZE_MB = 20;
const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'text/markdown': '.md',
};

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } },
  );

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const agentId = formData.get('agentId') as string | null;
  const mediaCategoryRaw = String(formData.get('media_category') || '').trim();
  const mediaCategory = mediaCategoryRaw === '' ? null : mediaCategoryRaw;

  if (!file || !agentId) {
    return NextResponse.json({ error: 'file and agentId are required' }, { status: 400 });
  }

  // Validate
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Файл превышает ${MAX_FILE_SIZE_MB} МБ` }, { status: 413 });
  }
  if (!ALLOWED_TYPES[file.type]) {
    return NextResponse.json({ error: `Неподдерживаемый тип файла: ${file.type}` }, { status: 415 });
  }

  try {
    const buffer = await file.arrayBuffer();

    // 1. Extract text immediately so we can store raw_content
    const rawText = await extractTextFromBuffer(buffer, file.type, file.name);

    // Validate media_category before uploading to avoid orphaned storage objects
    if (mediaCategory && !MEDIA_CATEGORIES.some((c) => c.id === mediaCategory)) {
      return NextResponse.json({ error: `Invalid media_category: ${mediaCategory}` }, { status: 400 });
    }

    // 2. Upload original file to Supabase Storage
    const storagePath = `kb/${agentId}/${Date.now()}-${file.name}`;
    const { error: storageErr } = await supabase.storage
      .from('knowledge-base')
      .upload(storagePath, Buffer.from(buffer), { contentType: file.type });

    if (storageErr) throw storageErr;

    const { data: source, error: sourceErr } = await supabase
      .from('kb_sources')
      .insert({
        agent_id: agentId,
        type: 'file',
        title: file.name,
        raw_content: rawText,
        status: 'pending',
        metadata: { storage_path: storagePath, mime_type: file.type, size_bytes: file.size, ...(mediaCategory ? { media_category: mediaCategory } : {}) },
      })
      .select()
      .single();

    if (sourceErr || !source) throw sourceErr ?? new Error('Failed to create source');

    // 4. Trigger async processing (fire-and-forget — webhook answers 200 immediately)
    // In production: use Supabase Edge Function or pg_cron trigger instead
    processKBSource(source.id).catch((err) =>
      console.error(`KB processing failed for source ${source.id}:`, err),
    );

    return NextResponse.json({ sourceId: source.id, status: 'processing' });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    console.error('KB upload error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}