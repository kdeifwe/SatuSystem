import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const admin = createAdminClient();
    
    // Get tags from kb_sources
    const { data: sources, error: sourcesError } = await admin
      .from('kb_sources')
      .select('metadata')
      .eq('agent_id', params.agentId)
      .not('metadata', 'is', null);

    // Get tags from kb_chunks
    const { data: chunks, error: chunksError } = await admin
      .from('kb_chunks')
      .select('metadata')
      .eq('agent_id', params.agentId)
      .not('metadata', 'is', null);

    const tags = new Set<string>();
    
    // Add tags from sources
    (sources || []).forEach((row: any) => {
      const tag = row?.metadata?.tag;
      if (typeof tag === 'string' && tag.trim()) tags.add(tag.trim());
    });
    
    // Add tags from chunks
    (chunks || []).forEach((row: any) => {
      const tag = row?.metadata?.tag;
      if (typeof tag === 'string' && tag.trim()) tags.add(tag.trim());
    });

    return NextResponse.json({ tags: Array.from(tags).sort() });
  } catch (err) {
    return errorResponse(err);
  }
}
