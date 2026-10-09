import { NextRequest, NextResponse } from 'next/server';
import { autoFillFromKnowledgeBase } from '@/lib/server/ai/auto-fill';
import { requireAgentAccess } from '@/lib/server/require-auth';

export async function POST(
  _req: NextRequest,
  { params }: { params: { agentId: string } },
) {
  const auth = await requireAgentAccess(params.agentId);
  if (!auth.ok) return auth.response;
  try {
    const result = await autoFillFromKnowledgeBase(params.agentId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
