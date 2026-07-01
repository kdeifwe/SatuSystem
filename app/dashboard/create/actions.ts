'use server';

import { createClient } from '@/lib/supabase/server';
import { processKBSource } from '@/lib/knowledge-base/processor';
import { revalidatePath } from 'next/cache';

export async function addTextSource(
  agentId: string,
  title: string,
  content: string
): Promise<{ id: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Не авторизован');

  const { data, error } = await supabase
    .from('kb_sources')
    .insert([
      {
        agent_id: agentId,
        type: 'manual',
        title,
        raw_content: content,
        status: 'pending',
      },
    ])
    .select('id')
    .single();

  if (error) throw error;

  revalidatePath(`/dashboard/${agentId}/knowledge`);
  
  // Trigger ingest in background without awaiting
  setImmediate(() =>
    processKBSource(data.id).catch((err: unknown) => console.error('[ingest] failed:', err))
  );
  
  return { id: data.id };
}

export async function addQASource(
  agentId: string,
  question: string,
  answer: string
): Promise<{ id: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Не авторизован');

  const { data, error } = await supabase
    .from('kb_sources')
    .insert([
      {
        agent_id: agentId,
        type: 'qa',
        title: question,
        raw_content: answer,
        status: 'pending',
      },
    ])
    .select('id')
    .single();

  if (error) throw error;

  revalidatePath(`/dashboard/${agentId}/knowledge`);
  
  setImmediate(() =>
    processKBSource(data.id).catch((err: unknown) => console.error('[ingest] failed:', err))
  );
  
  return { id: data.id };
}

export async function addWebsiteSource(
  agentId: string,
  url: string
): Promise<{ id: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Не авторизован');

  const { data, error } = await supabase
    .from('kb_sources')
    .insert([
      {
        agent_id: agentId,
        type: 'website',
        title: url,
        url,
        status: 'pending',
      },
    ])
    .select('id')
    .single();

  if (error) throw error;

  const sourceId = data.id;
  revalidatePath(`/dashboard/${agentId}/knowledge`);

  setImmediate(() =>
    processKBSource(sourceId).catch((err: unknown) => console.error('[ingest] failed:', err))
  );

  return { id: sourceId };
}

export async function addFileSource(
  agentId: string,
  formData: FormData
): Promise<{ id: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Не авторизован');

  const file = formData.get('file') as File | null;
  if (!file) throw new Error('Файл не найден');

  // Sanitize filename
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Create source record first
  const { data: sourceData, error: sourceError } = await supabase
    .from('kb_sources')
    .insert([
      {
        agent_id: agentId,
        type: 'file',
        title: file.name,
        status: 'pending',
        file_size: file.size,
        metadata: {
          mime_type: file.type,
        },
      },
    ])
    .select('id')
    .single();

  if (sourceError) throw sourceError;

  const sourceId = sourceData.id;

  // Upload file to storage
  const filePath = `${agentId}/${sourceId}/${sanitizedName}`;

  const { error: uploadError } = await supabase.storage.from('kb-files').upload(filePath, file);

  if (uploadError) {
    await supabase.from('kb_sources').delete().eq('id', sourceId);
    throw uploadError;
  }

  // Update source with file path
  await supabase.from('kb_sources').update({ file_path: filePath }).eq('id', sourceId);

  revalidatePath(`/dashboard/${agentId}/knowledge`);
  
  setImmediate(() =>
    processKBSource(sourceId).catch((err: unknown) => console.error('[ingest] failed:', err))
  );

  return { id: sourceId };
}
