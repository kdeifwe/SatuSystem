import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAgentAccess } from '@/lib/server/require-auth';

export async function POST(_request: NextRequest, { params }: { params: { agentId: string } }) {
  try {
    const access = await requireAgentAccess(params.agentId);
    if (!access.ok) return access.response;

    const admin = createAdminClient();
    const { error } = await admin.rpc('refresh_kb_chunk_links', {
      p_agent_id: params.agentId,
      p_top_k: 3,
      p_min_similarity: 0.75,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка пересчёта связей';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
