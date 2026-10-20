import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/server/require-auth';
import { analyzeLostCandidates, applyLostVerdicts } from '@/lib/server/lost-classifier';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 120;

// Ручная разметка причин отказов.
//   { mode: 'analyze', limit?, excludeLeadIds? } — ИИ предлагает кого считать потерянным и почему (в базу ничего не пишется)
//   { mode: 'apply', items: [{ leadId, reason, note?, lostAt? }] } — записывает то, что подтвердил человек
export async function POST(req: NextRequest, { params }: { params: { agentId: string } }) {
  const access = await requireAgentAccess(params.agentId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({}));

  try {
    if (body?.mode === 'apply') {
      const items = Array.isArray(body.items) ? body.items : [];
      const result = await applyLostVerdicts(access.admin, params.agentId, items);
      return NextResponse.json(result);
    }

    const excludeLeadIds = Array.isArray(body?.excludeLeadIds) ? body.excludeLeadIds.map(String).slice(0, 2000) : [];
    const result = await analyzeLostCandidates(access.admin, params.agentId, {
      limit: Number(body?.limit) || 25,
      excludeLeadIds,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[classify-lost] failed', message);
    const hint = /lost_(reason|note|at)/i.test(message) ? 'Сначала примените миграцию с колонками lost_reason.' : message;
    return NextResponse.json({ error: hint }, { status: 500 });
  }
}
