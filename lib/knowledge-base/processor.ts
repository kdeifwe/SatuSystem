import { createClient } from '@supabase/supabase-js';
import { chunkText, chunkQAPair } from './chunker';
import { generateEmbeddingsBatch } from './embeddings';
import { extractTextFromBuffer, extractTextFromURL } from './extractor';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function processKBSource(sourceId: string): Promise<void> {
  const supabase = getAdminClient();

  try {
    // 1. Обновить статус на 'processing'
    await supabase
      .from('kb_sources')
      .update({ status: 'processing' })
      .eq('id', sourceId);

    // 2. Получить источник
    const { data: source, error: fetchError } = await supabase
      .from('kb_sources')
      .select('*')
      .eq('id', sourceId)
      .single();

    if (fetchError || !source) throw new Error(`Source not found: ${sourceId}`);

    // 3. Получить текст в зависимости от типа
    let rawContent = source.raw_content;

    if (source.type === 'file') {
      // Скачать файл из storage bucket 'kb-files'
      const { data, error } = await supabase.storage
        .from('kb-files')
        .download(source.file_path);
      if (error) throw error;

      const buffer = await data.arrayBuffer();
      const mimeType = source.metadata?.mime_type as string ?? 'text/plain';
      rawContent = await extractTextFromBuffer(buffer, mimeType, source.file_path);

      // Сохранить raw_content
      await supabase
        .from('kb_sources')
        .update({ raw_content: rawContent })
        .eq('id', sourceId);
    } else if (source.type === 'website') {
      // Получить URL из source.url или source.metadata.url
      const url = source.url || source.metadata?.url;
      if (!url) throw new Error(`No URL for website source`);

      rawContent = await extractTextFromURL(url);

      // Сохранить raw_content
      await supabase
        .from('kb_sources')
        .update({ raw_content: rawContent })
        .eq('id', sourceId);
    }

    // 4. Удалить старые чанки перед вставкой новых (идемпотентность)
    await supabase
      .from('kb_chunks')
      .delete()
      .eq('source_id', sourceId);

    // 5. Создать чанки в зависимости от типа источника
    let chunks: Array<{ content: string; metadata: any }> = [];
    let priority = 'chunk';

    if (source.type === 'qa') {
      const chunk = chunkQAPair(source.title, source.raw_content, 0, source.title);
      chunks = [chunk];
      priority = 'qa';
    } else if (source.type === 'manual') {
      chunks = chunkText(source.raw_content);
      priority = 'structured';
    } else if (source.type === 'file' || source.type === 'website') {
      chunks = chunkText(rawContent);
      priority = 'chunk';
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }

    // 6. Вставить чанки батчами по 50
    const batchSize = 50;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      // Генерировать эмбеддинги для батча
      const embeddings = await generateEmbeddingsBatch(batch.map(c => c.content));

      // Создать записи чанков с эмбеддингами
      const chunkRecords = batch.map((chunk, idx) => ({
        source_id: sourceId,
        agent_id: source.agent_id,
        content: chunk.content,
        embedding: embeddings[idx],
        priority: priority,
        chunk_index: chunk.metadata.chunk_index,
        token_count: Math.floor(chunk.content.length / 4),
        metadata: {
          source_type: source.type,
          source_title: source.title,
          chunk_index: chunk.metadata.chunk_index,
          total_chunks: chunks.length,
          agent_id: source.agent_id,
        },
      }));

      // Вставить батч
      await supabase.from('kb_chunks').insert(chunkRecords);

      // Обновить pages_processed после каждого батша
      const pagesProcessed = Math.min(i + batchSize, chunks.length);
      await supabase
        .from('kb_sources')
        .update({ pages_processed: pagesProcessed })
        .eq('id', sourceId);
    }

    // 7. Обновить финальный статус на 'done'
    await supabase
      .from('kb_sources')
      .update({ status: 'done', pages_processed: chunks.length })
      .eq('id', sourceId);
  } catch (error) {
    // Обновить статус на 'error' и записать сообщение об ошибке
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await supabase
      .from('kb_sources')
      .update({ status: 'error', error_message: errorMessage })
      .eq('id', sourceId);

    throw error;
  }
}