import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { createAdminClient } from '@/lib/supabase/admin';
import { peekBaileysClient } from '@/lib/channels/baileys-client';

export const dynamic = 'force-dynamic';

const AUTH_ROOT = path.join(process.cwd(), 'baileys-auth');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function digitsOnly(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

async function phoneFromFile(agentId: string, lid: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(AUTH_ROOT, agentId, `lid-mapping-${lid}_reverse.json`), 'utf8');
    return digitsOnly(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function phoneFromSocket(agentId: string, jid: string): Promise<string | null> {
  try {
    const sock: any = peekBaileysClient(agentId)?.sock;
    const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
    return digitsOnly(String(pn ?? '').split('@')[0].split(':')[0]);
  } catch {
    return null;
  }
}

// Разовое заполнение whatsapp_phone для старых лидов с @lid.
// GET ?agent=<uuid>  — один агент (без параметра — все агенты)
//     &apply=1       — записать (без него только показать, сколько номеров удалось определить)
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apply = req.nextUrl.searchParams.get('apply') === '1';
  const agentParam = req.nextUrl.searchParams.get('agent');
  if (agentParam && !UUID_RE.test(agentParam)) {
    return NextResponse.json({ error: 'Bad agent id' }, { status: 400 });
  }

  const admin = createAdminClient();
  let agentIds: string[] = [];
  if (agentParam) {
    agentIds = [agentParam];
  } else {
    const { data } = await admin.from('agents').select('id').is('deleted_at', null);
    agentIds = (data ?? []).map((a: any) => String(a.id));
  }

  const summary = { apply, agents: agentIds.length, lidLeads: 0, alreadyHad: 0, resolved: 0, unresolved: 0, written: 0, errors: [] as string[] };
  const seen = new Set<string>();

  for (const agentId of agentIds) {
    const { data: rows, error } = await admin
      .from('conversations')
      .select('lead_id, leads!inner(id, external_id, attributes)')
      .eq('agent_id', agentId)
      .eq('is_sandbox', false);
    if (error) {
      summary.errors.push(`${agentId}: ${error.message}`);
      continue;
    }

    for (const row of rows ?? []) {
      const lead: any = Array.isArray((row as any).leads) ? (row as any).leads[0] : (row as any).leads;
      if (!lead || seen.has(lead.id)) continue;
      const externalId = String(lead.external_id ?? '');
      if (!externalId.endsWith('@lid')) continue;
      seen.add(lead.id);
      summary.lidLeads += 1;

      const attrs = (lead.attributes ?? {}) as Record<string, unknown>;
      if (digitsOnly(attrs.whatsapp_phone)) {
        summary.alreadyHad += 1;
        continue;
      }

      const lid = externalId.split('@')[0].split(':')[0];
      const phone = (await phoneFromFile(agentId, lid)) ?? (await phoneFromSocket(agentId, externalId));
      if (!phone) {
        summary.unresolved += 1;
        continue;
      }
      summary.resolved += 1;

      if (apply) {
        const { error: updateError } = await admin
          .from('leads')
          .update({ attributes: { ...attrs, whatsapp_phone: phone } })
          .eq('id', lead.id);
        if (updateError) summary.errors.push(`${lead.id}: ${updateError.message}`);
        else summary.written += 1;
      }
    }
  }

  return NextResponse.json(summary);
}
