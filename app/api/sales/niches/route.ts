import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

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

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from('niche_profiles').select('*').order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const { name, slug, traits, preferred_methodologies, system_prompt_addon } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 });
    }

    if (!isStringArray(preferred_methodologies)) {
      return NextResponse.json({ error: 'Preferred methodologies must be an array of strings' }, { status: 400 });
    }

    const parsedTraits = parseTraits(traits);

    const { data, error } = await supabase
      .from('niche_profiles')
      .insert({
        name,
        slug,
        traits: parsedTraits,
        preferred_methodologies,
        system_prompt_addon: system_prompt_addon || null,
      })
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
