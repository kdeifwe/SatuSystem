import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateQueryEmbedding } from '@/lib/knowledge-base/embeddings';

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

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

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid technique id' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('sales_techniques').select('*').eq('id', id).single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Technique not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid technique id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const updatePayload: Record<string, unknown> = {};

    if (body.methodology) updatePayload.methodology = body.methodology;
    if (body.technique_name) updatePayload.technique_name = body.technique_name;
    if (body.niche_tags !== undefined) {
      if (!isStringArray(body.niche_tags)) {
        return NextResponse.json({ error: 'Niche tags must be an array of strings' }, { status: 400 });
      }
      updatePayload.niche_tags = body.niche_tags;
    }
    if (body.trigger_text) updatePayload.trigger_text = body.trigger_text;
    if (body.script_template) updatePayload.script_template = body.script_template;
    if (body.examples !== undefined) {
      if (!isExampleArray(body.examples)) {
        return NextResponse.json({ error: 'Examples must be an array of niche_slug/example objects' }, { status: 400 });
      }
      updatePayload.examples = body.examples;
    }
    if (body.difficulty !== undefined) {
      if (!isValidDifficulty(body.difficulty)) {
        return NextResponse.json({ error: 'Difficulty must be beginner, intermediate, or advanced' }, { status: 400 });
      }
      updatePayload.difficulty = body.difficulty;
    }
    if (body.tokens_estimate !== undefined) {
      updatePayload.tokens_estimate = Number(body.tokens_estimate) || 50;
    }
    if (body.is_active !== undefined) {
      updatePayload.is_active = Boolean(body.is_active);
    }

    const supabase = createServiceClient();
    const { data: existing, error: fetchError } = await supabase
      .from('sales_techniques')
      .select('trigger_text')
      .eq('id', id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (body.trigger_text && existing?.trigger_text !== body.trigger_text) {
      try {
        updatePayload.trigger_embedding = await generateQueryEmbedding(body.trigger_text);
      } catch (error) {
        console.error('Embedding generation failed for updated sales technique:', (error as Error).message);
        updatePayload.trigger_embedding = null;
      }
    }

    const { data, error } = await supabase
      .from('sales_techniques')
      .update(updatePayload)
      .eq('id', id)
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

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid technique id' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('sales_techniques').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
