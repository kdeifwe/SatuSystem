import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F-]{36}$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export async function POST(request: Request) {
  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const { agent_id, niche_id, custom_methodologies, custom_prompt_addon } = body;

    if (!isUuid(agent_id) || !isUuid(niche_id)) {
      return NextResponse.json({ error: 'Agent id and niche id are required' }, { status: 400 });
    }

    if (custom_methodologies !== undefined && !isStringArray(custom_methodologies)) {
      return NextResponse.json({ error: 'Custom methodologies must be an array of strings' }, { status: 400 });
    }

    // Upsert: deactivate any existing assignment for this agent, then insert new active one
    await supabase
      .from('agent_niche_assignment')
      .update({ is_active: false })
      .eq('agent_id', agent_id)
      .eq('is_active', true);

    const { data, error } = await supabase
      .from('agent_niche_assignment')
      .insert({
        agent_id,
        niche_id,
        custom_methodologies: custom_methodologies ?? null,
        custom_prompt_addon: custom_prompt_addon ?? null,
        is_active: true,
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
