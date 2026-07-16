import mammoth from 'mammoth';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildCategoriesSummary, normalizeCategory } from '@/lib/ai/knowledge/categories';
import { categorizeChunks } from '@/lib/ai/knowledge/categorizer';
import { GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY } from '@/lib/server/ai/gemini-client';

export async function embedText(text: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY не задан');
  }

  const embRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: { parts: [{ text: text.slice(0, 2000) }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY,
      }),
    }
  );
  const embData = await embRes.json();

  if (!embRes.ok) {
    console.error('Embedding error:', JSON.stringify(embData));
    throw new Error(`Embedding API error: ${embData.error?.message}`);
  }

  const vector = embData.embedding?.values;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error('Empty embedding vector returned');
  }

  console.log('[KB] Embedding generated, dimensions:', vector.length);
  return vector;
}

function sanitizeJsonResponse(text: string) {
  return text.replace(/```json|```/g, '').trim();
}

function createChunksFromText(text: string) {
  const chunks: Array<{ type: string; title: string; content: string }> = [];
  for (let i = 0; i < text.length; i += 700) {
    chunks.push({
      type: 'other',
      title: `Фрагмент ${chunks.length + 1}`,
      content: text.slice(i, i + 800),
    });
  }
  return chunks;
}

async function parseWithAI(text: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY не задан');
  }

  const prompt = `Раздели на логические элементы. Для каждого: type (product/qa/procedure/contacts/file/other), title (до 80 символов), content. Верни [{type,title,content}]. Текст:\n${text.slice(0, 8000)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateMessage?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: { text: 'Отвечай ТОЛЬКО валидным JSON массивом без markdown, без пояснений.' },
          },
          {
            role: 'user',
            content: { text: prompt },
          },
        ],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini API error: ${JSON.stringify(data)}`);
  }

  const outputText =
    data?.candidates?.[0]?.content?.[0]?.text ||
    data?.candidates?.[0]?.content?.text ||
    data?.output?.[0]?.content?.text ||
    data?.message?.content?.text ||
    data?.output?.text ||
    '';

  const cleaned = sanitizeJsonResponse(String(outputText));
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini returned unexpected structure');
  }

  return parsed.map((item: any) => ({
    type: normalizeCategory(item?.type || 'other'),
    title: String(item?.title || '').slice(0, 80),
    content: String(item?.content || ''),
  }));
}

export async function processSource(sourceId: string, agentId: string, useAI: boolean = true) {
  const admin = createAdminClient();
  const { data: source, error: fetchError } = await admin
    .from('kb_sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) {
    throw new Error(fetchError?.message || `Source ${sourceId} not found`);
  }

  const currentAgentId = source.agent_id || agentId;
  let text = '';

  try {
    if (source.metadata?.source_type === 'instagram') {
      text = source.raw_content || source.title || '';
    } else if (source.type === 'file') {
      if (!source.file_path) {
        throw new Error('file_path не задан для source.type=file');
      }

      const { data: downloadData, error: downloadError } = await admin.storage
        .from('kb-files')
        .download(source.file_path);

      if (downloadError || !downloadData) {
        throw downloadError || new Error('Не удалось скачать файл');
      }

      const buffer = Buffer.from(await downloadData.arrayBuffer());
      const lowerPath = source.file_path.toLowerCase();

      if (lowerPath.endsWith('.pdf')) {
        // @ts-expect-error pdfjs-dist has no types
        const pdfModule = await import('pdfjs-dist/build/pdf.mjs');
        const pdf = (pdfModule as any).getDocument || (pdfModule as any).default?.getDocument || (pdfModule as any);
        if (!pdf) {
          throw new Error('Could not load PDF module');
        }
        try {
          const doc = await pdf(buffer);
          let fullText = '';
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const pageText = (content as any).items.map((item: any) => item.str || '').join(' ');
            fullText += pageText + '\n';
          }
          text = fullText;
        } catch {
          text = 'Could not extract PDF text';
        }
      } else if (lowerPath.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else if (lowerPath.endsWith('.txt') || lowerPath.endsWith('.csv')) {
        text = buffer.toString('utf-8');
      } else {
        text = buffer.toString('utf-8');
      }
    } else if (source.type === 'website') {
      const url = source.url || source.metadata?.url || source.title;
      if (!url) {
        throw new Error('URL не задан для source.type=website');
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Не удалось загрузить сайт: ${response.status}`);
      }
      const html = await response.text();
      text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (source.type === 'manual' || source.type === 'qa') {
      text = source.raw_content || source.title || '';
    } else {
      text = source.raw_content || source.title || '';
    }

    const normalizedText = String(text || '').trim();
    const useAiFlow = useAI && normalizedText.length > 200;
    let elements: Array<{ type: string; title: string; content: string }> = [];

    if (useAiFlow) {
      try {
        elements = await parseWithAI(normalizedText);
        if (!elements.length) {
          elements = createChunksFromText(normalizedText);
        }
      } catch (error) {
        elements = createChunksFromText(normalizedText);
      }
    } else {
      elements = createChunksFromText(normalizedText);
    }

    await admin.from('kb_chunks').delete().eq('source_id', sourceId);

    const chunkContents = elements.map((item) => item.content).filter(Boolean);
    const chunkCategories = await categorizeChunks(chunkContents);
    const chunkRecords = [] as Array<Record<string, unknown>>;

    for (const [index, item] of elements.entries()) {
      const category = normalizeCategory(chunkCategories[index] ?? item.type);
      const vector = await embedText(item.content);
      chunkRecords.push({
        source_id: sourceId,
        agent_id: currentAgentId,
        content: item.content,
        embedding: vector,
        metadata: {
          category,
          type: category,
          title: item.title,
          source_name: source.title,
          tag: source.metadata?.tag,
        },
      });
    }

    if (chunkRecords.length) {
      await admin.from('kb_chunks').insert(chunkRecords);
    }

    const nextMetadata = {
      ...(source.metadata || {}),
      processed_at: new Date().toISOString(),
      chunks_count: elements.length,
      categories_summary: buildCategoriesSummary(chunkCategories),
    };
    delete nextMetadata.error;
    delete nextMetadata.error_hint;
    delete nextMetadata.failed_at;

    await admin
      .from('kb_sources')
      .update({
        status: 'done',
        raw_content: normalizedText.slice(0, 2000),
        metadata: nextMetadata,
      })
      .eq('id', sourceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[KB] Source processing failed for ${sourceId}:`, message);
    const errorMetadata = {
      ...(source.metadata || {}),
      error: message,
      failed_at: new Date().toISOString(),
      ...(source.metadata?.source_type === 'instagram' ? { error_hint: source.metadata.error_hint || 'Instagram ограничивает автоматический доступ. Попробуйте скопировать нужный текст вручную через вкладку «Ввод вручную».' } : {}),
    };
    await admin
      .from('kb_sources')
      .update({
        status: 'error',
        metadata: errorMetadata,
      })
      .eq('id', sourceId);
    throw error;
  }
}
