import { NextRequest, NextResponse } from 'next/server';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';

const AUTH_ROOT = path.join(process.cwd(), 'baileys-auth');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISS_TTL_MS = 60_000;
const lidCache = new Map<string, { phone: string | null; at: number }>();

function digitsOnly(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

async function lookupLidPhone(agentId: string, lid: string): Promise<string | null> {
  if (!UUID_RE.test(agentId)) return null;

  const key = `${agentId}:${lid}`;
  const cached = lidCache.get(key);
  if (cached && (cached.phone || Date.now() - cached.at < MISS_TTL_MS)) {
    return cached.phone;
  }

  const dirPath = path.join(AUTH_ROOT, agentId);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('lid-mapping-') || !entry.name.endsWith('_reverse.json')) continue;

      const filePath = path.join(dirPath, entry.name);
      const raw = await fs.readFile(filePath, 'utf8');
      const phone = digitsOnly(JSON.parse(raw));
      const fileLid = entry.name.match(/^lid-mapping-(\d+)_reverse\.json$/)?.[1];

      if (phone && fileLid === lid) {
        lidCache.set(key, { phone, at: Date.now() });
        return phone;
      }
    }
  } catch {
    // no mapping file for this agent/session
  }

  lidCache.set(key, { phone: null, at: Date.now() });
  return null;
}

async function resolveLeadPhone(agentId: string, lead: any): Promise<string | null> {
  const attrs = (lead.attributes ?? {}) as Record<string, unknown>;
  const savedWhatsappPhone = digitsOnly(attrs.whatsapp_phone);
  if (savedWhatsappPhone) return savedWhatsappPhone;

  const externalId = String(lead.external_id ?? '');
  const [rawUser, server] = externalId.split('@');
  const user = String(rawUser ?? '').split(':')[0];

  if (server === 's.whatsapp.net') return digitsOnly(user);

  if (server === 'lid' && /^\d+$/.test(user)) {
    const mapped = await lookupLidPhone(agentId, user);
    if (mapped) return mapped;
  }

  return digitsOnly(attrs.phone);
}

export async function GET(req: NextRequest, { params }: { params: { agentId: string } }) {
  const supabase = createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: agent } = await admin.from('agents').select('org_id').eq('id', params.agentId).single();
  if (!agent) return NextResponse.json({ leads: [] });

  // Получаем лидов с последним сообщением
  const { data: conversations } = await admin
    .from('conversations')
    .select(`
      id,
      lead_id,
      leads!inner(id, name, external_id, status, created_at, updated_at, org_id, ai_enabled, attributes),
      messages(content, sender, created_at)
    `)
    .eq('agent_id', params.agentId)
    .eq('leads.org_id', agent.org_id)
    .eq('is_sandbox', false)
    .order('started_at', { ascending: false });

  const leadsMap = new Map<string, any>();
  for (const conv of conversations ?? []) {
    const lead = (conv as any).leads;
    if (!lead || leadsMap.has(lead.id)) continue;

    const msgs = ((conv as any).messages ?? []).sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { attributes: _attributes, ...leadPublic } = lead;
    leadsMap.set(lead.id, {
      ...leadPublic,
      phone: await resolveLeadPhone(params.agentId, lead),
      conversation_id: conv.id,
      last_message: msgs[0]?.content?.slice(0, 60) ?? null,
    });
  }

  return NextResponse.json({ leads: Array.from(leadsMap.values()) });
}
