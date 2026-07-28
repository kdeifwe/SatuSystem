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

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid example id' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('conversation_examples')
    .select('*, niche_profiles(name,slug), sales_techniques(technique_name)')
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Conversation example not found' }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid example id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const updatePayload: Record<string, unknown> = {};

    if (body.niche_id) {
      if (!isUuid(body.niche_id)) {
        return NextResponse.json({ error: 'Invalid niche id' }, { status: 400 });
      }
      updatePayload.niche_id = body.niche_id;
    }

    if (body.technique_id) {
      if (!isUuid(body.technique_id)) {
        return NextResponse.json({ error: 'Invalid technique id' }, { status: 400 });
      }
      updatePayload.technique_id = body.technique_id;
    }

    if (body.situation_text !== undefined) {
      if (typeof body.situation_text !== 'string' || !body.situation_text.trim()) {
        return NextResponse.json({ error: 'Situation text is required' }, { status: 400 });
      }
      updatePayload.situation_text = body.situation_text;
    }

    if (body.agent_reply !== undefined) {
      updatePayload.agent_reply = body.agent_reply;
    }

    if (body.outcome !== undefined) {
      if (!isValidOutcome(body.outcome)) {
        return NextResponse.json({ error: 'Invalid outcome value' }, { status: 400 });
      }
      updatePayload.outcome = body.outcome;
    }

    if (body.channel !== undefined) {
      updatePayload.channel = body.channel;
    }

    const supabase = createServiceClient();
    const { data: existing, error: fetchError } = await supabase
      .from('conversation_examples')
      .select('situation_text')
      .eq('id', id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (body.situation_text && existing?.situation_text !== body.situation_text) {
      try {
        updatePayload.situation_embedding = await generateQueryEmbedding(body.situation_text);
      } catch (error) {
        console.error('Embedding generation failed for updated conversation example:', (error as Error).message);
        updatePayload.situation_embedding = null;
      }
    }

    const { data, error } = await supabase
      .from('conversation_examples')
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
    return NextResponse.json({ error: 'Invalid example id' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('conversation_examples').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
