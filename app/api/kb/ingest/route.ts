import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const { sourceId } = await request.json();
    if (!sourceId) return Response.json({ error: 'sourceId required' }, { status: 400 });

    const { processSource } = await import('@/lib/server/knowledge/processor');
    const supabase = createAdminClient();
    const { data: source, error } = await supabase
      .from('kb_sources')
      .select('agent_id, metadata')
      .eq('id', sourceId)
      .single();

    if (error || !source) {
      return Response.json({ error: 'source not found' }, { status: 404 });
    }

    setImmediate(() =>
      processSource(sourceId, source.agent_id, source.metadata?.use_ai !== false).catch((err: unknown) => console.error('[ingest] failed:', err))
    );

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
