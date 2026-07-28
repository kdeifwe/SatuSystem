import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseTraits(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('Traits must be a valid JSON object');
    }
  }

  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  throw new Error('Traits must be a JSON object');
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid niche id' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from('niche_profiles').select('*').eq('id', id).single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Niche not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid niche id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const updatePayload: Record<string, unknown> = {};

    if (body.name) {
      updatePayload.name = body.name;
    }
    if (body.slug) {
      updatePayload.slug = body.slug;
    }
    if (body.traits !== undefined) {
      updatePayload.traits = parseTraits(body.traits);
    }
    if (body.preferred_methodologies !== undefined) {
      if (!isStringArray(body.preferred_methodologies)) {
        return NextResponse.json({ error: 'Preferred methodologies must be an array of strings' }, { status: 400 });
      }
      updatePayload.preferred_methodologies = body.preferred_methodologies;
    }
    if (body.system_prompt_addon !== undefined) {
      updatePayload.system_prompt_addon = body.system_prompt_addon;
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('niche_profiles')
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
    return NextResponse.json({ error: 'Invalid niche id' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('niche_profiles').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
