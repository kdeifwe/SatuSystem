import { NextRequest, NextResponse } from 'next/server';
import { generateFunnelFromContext } from '@/lib/server/ai/generate-funnel';

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } },
) {
  try {
    const body = await req.json();
    const steps = await generateFunnelFromContext(params.agentId, {
      scenario: body?.scenario || 'sales',
      goal: body?.goal || '',
      targetAudience: body?.targetAudience || '',
      firstQuestion: body?.firstQuestion || '',
      commonObjections: Array.isArray(body?.commonObjections) ? body.commonObjections : [],
      companyDescription: body?.companyDescription || '',
    });

    return NextResponse.json(steps);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate funnel' }, { status: 500 });
  }
}
