import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateQueryEmbedding } from '@/lib/knowledge-base/embeddings';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidDifficulty(value: unknown): value is 'beginner' | 'intermediate' | 'advanced' {
  return value === 'beginner' || value === 'intermediate' || value === 'advanced';
}

function isExampleArray(value: unknown): value is Array<{ niche_slug: string; example: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as any).niche_slug === 'string' &&
        typeof (item as any).example === 'string'
    )
  );
}

export async function GET(request: Request) {
  const supabase = createServiceClient();
  const url = new URL(request.url);
  const niche = url.searchParams.get('niche');

  let query = supabase.from('sales_techniques').select('*').order('methodology', { ascending: true });

  if (niche) {
    query = query.contains('niche_tags', [niche]);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const {
      methodology,
      technique_name,
      niche_tags,
      trigger_text,
      script_template,
      examples,
      difficulty,
      tokens_estimate,
    } = body;

    if (!methodology || !technique_name || !trigger_text || !script_template) {
      return NextResponse.json({ error: 'Methodology, technique name, trigger text and script template are required' }, { status: 400 });
    }

    if (!isStringArray(niche_tags)) {
      return NextResponse.json({ error: 'Niche tags must be an array of strings' }, { status: 400 });
    }

    if (!isExampleArray(examples)) {
      return NextResponse.json({ error: 'Examples must be an array of niche_slug/example objects' }, { status: 400 });
    }

    if (!isValidDifficulty(difficulty)) {
      return NextResponse.json({ error: 'Difficulty must be beginner, intermediate, or advanced' }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      methodology,
      technique_name,
      niche_tags,
      trigger_text,
      script_template,
      examples,
      difficulty,
      tokens_estimate: Number(tokens_estimate) || 50,
      is_active: true,
    };

    try {
      payload.trigger_embedding = await generateQueryEmbedding(trigger_text);
    } catch (error) {
      console.error('Embedding generation failed for sales technique:', (error as Error).message);
      payload.trigger_embedding = null;
    }

    const { data, error } = await supabase
      .from('sales_techniques')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
