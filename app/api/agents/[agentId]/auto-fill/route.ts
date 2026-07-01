import { NextRequest, NextResponse } from 'next/server';
import { autoFillFromKnowledgeBase } from '@/lib/server/ai/auto-fill';

export async function POST(
  _req: NextRequest,
  { params }: { params: { agentId: string } },
) {
  try {
    const result = await autoFillFromKnowledgeBase(params.agentId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
