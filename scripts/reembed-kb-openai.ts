import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openAiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

if (!openAiKey) {
  throw new Error('Missing OPENAI_API_KEY for re-embedding job');
}

const openAiModel = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const embeddingDim = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? 768);
const batchSize = 32;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function fetchEmbeddings(texts: string[]) {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openAiModel,
        input: texts,
        dimensions: embeddingDim,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      return data.data.map((item: any) => item.embedding);
    }

    if (response.status === 429 || response.status >= 500) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`OpenAI embed batch attempt ${attempt + 1} failed (${response.status}), retrying in ${delay}ms`);
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }

    const body = await response.text();
    throw new Error(`OpenAI embed failed (${response.status}): ${body}`);
  }

  throw new Error('OpenAI embed: max retries exceeded');
}

async function main() {
  const { data: rows, error } = await supabase
    .from('kb_chunks')
    .select('id, content')
    .is('embedding', null)
    .not('content', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  const validRows = (rows ?? []).filter((row) => typeof row.content === 'string' && row.content.trim().length > 0);
  console.log(`Found ${validRows.length} chunks to re-embed`);

  for (let i = 0; i < validRows.length; i += batchSize) {
    const batch = validRows.slice(i, i + batchSize);
    const texts = batch.map((row) => row.content);
    const embeddings = await fetchEmbeddings(texts);

    for (let j = 0; j < batch.length; j += 1) {
      const row = batch[j];
      const embedding = embeddings[j];

      const { error: updateErr } = await supabase
        .from('kb_chunks')
        .update({
          embedding,
          embedding_provider: 'openai',
          embedding_model: openAiModel,
        })
        .eq('id', row.id);

      if (updateErr) {
        throw updateErr;
      }
    }

    console.log(`Updated batch ${i + 1}..${Math.min(i + batch.length, validRows.length)}/${validRows.length}`);
  }

  const { count, error: countErr } = await supabase
    .from('kb_chunks')
    .select('*', { count: 'exact', head: true })
    .neq('embedding_provider', 'openai')
    .or(`embedding_model.neq.${openAiModel},embedding_provider.is.null`);

  if (countErr) {
    throw countErr;
  }

  console.log('Remaining non-OpenAI rows:', count ?? 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
