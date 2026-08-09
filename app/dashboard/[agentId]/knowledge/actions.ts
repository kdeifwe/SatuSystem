'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

async function triggerIngest(sourceId: string): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/kb/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId }),
    });
    if (!response.ok) {
      throw new Error(`Ingest trigger failed: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to trigger ingest:', error);
    throw error;
  }
}

export async function addTextSource(
  agentId: string,
  title: string,
  content: string,
  inlineInPrompt: boolean = false
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
        inline_in_prompt: inlineInPrompt,
      },
    ])
    .select('id')
    .single();

  if (error) throw error;

  revalidatePath(`/dashboard/${agentId}/knowledge`);
  await triggerIngest(data.id);
  return { id: data.id };
}

export async function addQASource(
  agentId: string,
  question: string,
  answer: string,
  inlineInPrompt: boolean = false
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
        inline_in_prompt: inlineInPrompt,
      },
    ])
    .select('id')
    .single();

  if (error) throw error;

  revalidatePath(`/dashboard/${agentId}/knowledge`);
  await triggerIngest(data.id);
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

  // Trigger ingest in background
  await triggerIngest(sourceId);

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
  const storagePath = `${agentId}/${sourceId}/${sanitizedName}`;

  // Upload file to storage
  const buffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from('kb-files')
    .upload(storagePath, buffer, {
      contentType: file.type,
    });

  if (uploadError) {
    // Clean up the source record if upload fails
    await supabase.from('kb_sources').delete().eq('id', sourceId);
    throw uploadError;
  }

  // Update source with file_path
  await supabase
    .from('kb_sources')
    .update({ file_path: storagePath })
    .eq('id', sourceId);

  revalidatePath(`/dashboard/${agentId}/knowledge`);

  // Trigger ingest in background
  await triggerIngest(sourceId);

  return { id: sourceId };
}

export async function deleteSource(
  agentId: string,
  sourceId: string
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Не авторизован');

  // Get source to check for file_path
  const { data: source, error: fetchError } = await supabase
    .from('kb_sources')
    .select('file_path')
    .eq('id', sourceId)
    .eq('agent_id', agentId)
    .single();

  if (fetchError) throw fetchError;

  // Delete file from storage if exists
  if (source?.file_path) {
    await supabase.storage.from('kb-files').remove([source.file_path]);
  }

  // Delete source record (cascades to chunks)
  const { error: deleteError } = await supabase
    .from('kb_sources')
    .delete()
    .eq('id', sourceId)
    .eq('agent_id', agentId);

  if (deleteError) throw deleteError;

  revalidatePath(`/dashboard/${agentId}/knowledge`);
}

export async function retrySource(
  agentId: string,
  sourceId: string
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Не авторизован');

  // Verify source exists and belongs to agent
  const { error: checkError } = await supabase
    .from('kb_sources')
    .select('id')
    .eq('id', sourceId)
    .eq('agent_id', agentId)
    .single();

  if (checkError) throw checkError;

  // Update status to pending
  await supabase
    .from('kb_sources')
    .update({ status: 'pending' })
    .eq('id', sourceId);

  revalidatePath(`/dashboard/${agentId}/knowledge`);

  // Trigger ingest
  await triggerIngest(sourceId);
}
