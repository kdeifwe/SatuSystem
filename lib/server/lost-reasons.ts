import type { SupabaseClient } from '@supabase/supabase-js';
import { LOST_REASON_LABELS, PROMPT_FIXABLE_REASONS, normalizeLostReason, type LostReason } from '@/lib/lost-reasons';

export interface LostReasonStat {
  reason: LostReason;
  label: string;
  count: number;
  share: number;
  fixable: boolean;
}

export interface LostReasonStats {
  total: number;
  days: number;
  reasons: LostReasonStat[];
}

function oneLead(embedded: unknown): any {
  return Array.isArray(embedded) ? embedded[0] : embedded;
}

// Сколько потеряно лидов у агента за период и по каким причинам.
export async function getLostReasonStats(admin: SupabaseClient, agentId: string, days = 30): Promise<LostReasonStats> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const empty: LostReasonStats = { total: 0, days, reasons: [] };

  const { data, error } = await admin
    .from('conversations')
    .select('lead_id, leads!inner(id, status, lost_reason, lost_at)')
    .eq('agent_id', agentId)
    .eq('is_sandbox', false)
    .eq('leads.status', 'lost')
    .gte('leads.lost_at', since)
    .limit(5000);

  if (error) {
    console.warn('[lost-reasons] stats query failed', error.message);
    return empty;
  }

  const seen = new Set<string>();
  const counts = new Map<LostReason, number>();
  for (const row of data ?? []) {
    const lead = oneLead((row as any).leads);
    if (!lead || seen.has(lead.id)) continue;
    seen.add(lead.id);
    const reason = normalizeLostReason(lead.lost_reason) ?? 'other';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  const total = seen.size;
  if (total === 0) return empty;

  const reasons = Array.from(counts.entries())
    .map(([reason, count]) => ({
      reason,
      label: LOST_REASON_LABELS[reason],
      count,
      share: Math.round((count / total) * 100),
      fixable: PROMPT_FIXABLE_REASONS.includes(reason),
    }))
    .sort((a, b) => b.count - a.count);

  return { total, days, reasons };
}

export function formatLostStats(stats: LostReasonStats): string {
  if (stats.total === 0) return '';
  const parts = stats.reasons.map((r) => `${r.label}: ${r.count} (${r.share}%)${r.fixable ? '' : ' [не связано с промптом]'}`);
  return `Lost leads in the last ${stats.days} days: ${stats.total}. Refusal reasons: ${parts.join('; ')}.`;
}

// Реальные диалоги потерянных лидов (для критика и генератора улучшений).
export async function getLostDialogueExamples(
  admin: SupabaseClient,
  agentId: string,
  reason: LostReason | null,
  options: { days?: number; limit?: number; messagesPerDialogue?: number } = {},
): Promise<string> {
  const days = options.days ?? 60;
  const limit = options.limit ?? 3;
  const perDialogue = options.messagesPerDialogue ?? 10;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let query = admin
    .from('conversations')
    .select('id, lead_id, leads!inner(id, status, lost_reason, lost_note, lost_at)')
    .eq('agent_id', agentId)
    .eq('is_sandbox', false)
    .eq('leads.status', 'lost')
    .gte('leads.lost_at', since)
    .limit(60);

  query = reason ? query.eq('leads.lost_reason', reason) : query.in('leads.lost_reason', PROMPT_FIXABLE_REASONS);

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    if (error) console.warn('[lost-reasons] examples query failed', error.message);
    return '';
  }

  const seen = new Set<string>();
  const picked: Array<{ convId: string; lead: any }> = [];
  const sorted = [...data].sort(
    (a: any, b: any) => new Date(oneLead(b.leads)?.lost_at ?? 0).getTime() - new Date(oneLead(a.leads)?.lost_at ?? 0).getTime(),
  );
  for (const row of sorted as any[]) {
    const lead = oneLead(row.leads);
    if (!lead || seen.has(lead.id)) continue;
    seen.add(lead.id);
    picked.push({ convId: row.id, lead });
    if (picked.length >= limit) break;
  }

  let text = '';
  let index = 1;
  for (const { convId, lead } of picked) {
    const { data: msgs } = await admin
      .from('messages')
      .select('sender, content, created_at')
      .eq('conversation_id', convId)
      .in('sender', ['user', 'ai', 'operator'])
      .order('created_at', { ascending: false })
      .limit(perDialogue);
    if (!msgs || msgs.length === 0) continue;

    const label = LOST_REASON_LABELS[normalizeLostReason(lead.lost_reason) ?? 'other'];
    const note = lead.lost_note ? `; note: ${String(lead.lost_note).slice(0, 200)}` : '';
    text += `--- Lost dialogue ${index} (reason: ${label}${note}) ---\n`;
    for (const m of [...msgs].reverse()) {
      const role = m.sender === 'ai' ? 'Agent' : m.sender === 'user' ? 'Client' : 'Operator';
      text += `${role}: ${String(m.content ?? '').replace(/\n/g, ' ').slice(0, 300)}\n`;
    }
    text += '\n';
    index += 1;
  }
  return text.trim();
}
