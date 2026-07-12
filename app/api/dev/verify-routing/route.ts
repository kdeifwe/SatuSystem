import { NextResponse } from 'next/server';
import { runAgentTurn } from '@/lib/server/ai/orchestrator';

export async function POST(req: Request) {
  const { agentId, message } = await req.json();
  const result = await runAgentTurn(agentId, '', message, []);
  return NextResponse.json(result);
}
