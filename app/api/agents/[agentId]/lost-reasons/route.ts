import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/server/require-auth';
import { getLostReasonStats } from '@/lib/server/lost-reasons';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, { params }: { params: { agentId: string } }) {
  const access = await requireAgentAccess(params.agentId);
  if (!access.ok) return access.response;

  const stats = await getLostReasonStats(access.admin, params.agentId, 30);
  return NextResponse.json(stats);
}
