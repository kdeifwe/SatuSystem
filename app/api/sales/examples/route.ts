import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { generateQueryEmbedding } from '@/lib/knowledge-base/embeddings';

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

function isValidOutcome(value: unknown): value is 'lead_converted' | 'appointment_set' | 'objection_handled' | 'follow_up_scheduled' | 'lost' {
  return (
    value === 'lead_converted' ||
    value === 'appointment_set' ||
    value === 'objection_handled' ||
    value === 'follow_up_scheduled' ||
    value === 'lost'
  );
}

export async function GET() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('conversation_examples')
    .select(
      'id, niche_id, technique_id, situation_text, agent_reply, outcome, channel, niche_profiles(name,slug), sales_techniques(technique_name)'
    )
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const { niche_id, technique_id, situation_text, agent_reply, outcome, channel } = body;

    if (!niche_id || !technique_id || !situation_text || !agent_reply || !outcome) {
      return NextResponse.json({ error: 'Niche, technique, situation text, agent reply, and outcome are required' }, { status: 400 });
    }

    if (!isUuid(niche_id) || !isUuid(technique_id)) {
      return NextResponse.json({ error: 'Invalid niche or technique id' }, { status: 400 });
    }

    if (!isValidOutcome(outcome)) {
      return NextResponse.json({ error: 'Invalid outcome value' }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      niche_id,
      technique_id,
      situation_text,
      agent_reply,
      outcome,
      channel: channel || null,
    };

    try {
      payload.situation_embedding = await generateQueryEmbedding(situation_text);
    } catch (error) {
      console.error('Embedding generation failed for conversation example:', (error as Error).message);
      payload.situation_embedding = null;
    }

    const { data, error } = await supabase
      .from('conversation_examples')
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
