import type { SupabaseClient } from '@supabase/supabase-js';
import { llmClient, type LLMMessage } from '@/lib/server/ai/llm-client';
import { GEMINI_CHAT_MODEL } from '@/lib/server/ai/gemini-client';
import { LOST_NOTE_MAX, LOST_REASON_LABELS, normalizeLostReason, type LostReason } from '@/lib/lost-reasons';

export interface LostVerdict {
  leadId: string;
  conversationId: string;
  name: string;
  reason: LostReason;
  label: string;
  note: string;
  confidence: 'high' | 'medium' | 'low';
  lastClientMessage: string;
  lostAt: string;
}

export interface AnalyzeResult {
  processedLeadIds: string[];
  verdicts: LostVerdict[];
  remaining: number;
  skippedNoReply: number;
  failed: number;
}

const MAX_BATCH = 40;
const CONCURRENCY = 8;

// Признаки возможного отказа в сообщениях клиента (русский и казахский) для быстрого поиска.
const REFUSAL_MARKERS = new RegExp(
  [
    'не надо', 'не нужно', 'не нужен', 'не нужна', 'не интересно', 'неинтересно', 'не буду', 'отказыва', 'отказ ',
    'дорого', 'дороговато', 'слишком дорог', 'передумал', 'уже купил', 'выбрал друг', 'нашел друг', 'нашёл друг',
    'не актуал', 'не пишите', 'не беспокойте', 'отпишитесь', 'керек емес', 'қажет емес', 'қымбат', 'қызық емес',
    'ойымнан шықты', 'жазбаңыз', 'алмаймын',
  ].join('|'),
  'i',
);

async function findConversationsWithRefusalWords(admin: SupabaseClient, convIds: string[]): Promise<Set<string>> {
  const matched = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < convIds.length; i += 50) chunks.push(convIds.slice(i, i + 50));

  for (let i = 0; i < chunks.length; i += 4) {
    await Promise.all(
      chunks.slice(i, i + 4).map(async (chunk) => {
        const { data, error } = await admin
          .from('messages')
          .select('conversation_id, content')
          .in('conversation_id', chunk)
          .eq('sender', 'user')
          .limit(2000);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) {
          if (REFUSAL_MARKERS.test(String((row as any).content ?? ''))) matched.add((row as any).conversation_id);
        }
      }),
    );
  }
  return matched;
}
// Для ручной разметки причин берём только то, что клиент выразил явно.
const SELECTABLE_REASONS: LostReason[] = ['price', 'timing', 'competitor', 'postponed', 'wrong_product', 'other'];

function oneLead(embedded: unknown): any {
  return Array.isArray(embedded) ? embedded[0] : embedded;
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You review a chat between an AI sales agent and a client (Russian or Kazakh) and decide whether the client was LOST, and why.

Verdict "lost" ONLY if the client EXPLICITLY declined or clearly ended the deal: said no or "not interested", refused because of price/terms and left, chose a competitor, bought elsewhere, said the product is not what they need, or asked to stop writing.
Messages about the client's personal state or distress, jokes, or topics unrelated to buying are NOT refusals: return "not_lost".
Verdict "not_lost" for everything else: "I'll think", "later", still asking questions, negotiating, booked/paid/agreed, unclear, or simply no answer.

If lost, "reason" is one of:
- price: price too high / no budget
- timing: dates, delivery or duration do not fit
- competitor: chose or already uses another provider
- postponed: changed their mind or postponed the decision without a concrete objection
- wrong_product: needs a different product or service than offered
- other: any other explicit refusal

Return ONLY one JSON object, no markdown:
{"verdict":"lost"|"not_lost","reason":null|"price"|"timing"|"competitor"|"postponed"|"wrong_product"|"other","note":"short paraphrase in Russian of why, max 150 chars","confidence":"high"|"medium"|"low"}`;

async function classifyTranscript(transcript: string): Promise<{ lost: boolean; reason: LostReason; note: string; confidence: 'high' | 'medium' | 'low' } | null> {
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Chat:\n${transcript}\n\nReturn the JSON.` },
  ];
  const response = await llmClient.generate({ model: GEMINI_CHAT_MODEL, messages, temperature: 0.1, maxTokens: 300 });
  const parsed = extractJson(String(response.text ?? ''));
  if (!parsed) return null;

  if (parsed.verdict !== 'lost') return { lost: false, reason: 'other', note: '', confidence: 'low' };

  const reason = normalizeLostReason(parsed.reason);
  const safeReason: LostReason = reason && SELECTABLE_REASONS.includes(reason) ? reason : 'other';
  const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low';
  const note = String(parsed.note ?? '').trim().slice(0, LOST_NOTE_MAX);
  return { lost: true, reason: safeReason, note, confidence };
}

// Ручной анализ: ничего не пишет в базу, только возвращает предложения.
export async function analyzeLostCandidates(
  admin: SupabaseClient,
  agentId: string,
  options: { limit?: number; excludeLeadIds?: string[]; quick?: boolean } = {},
): Promise<AnalyzeResult> {
  const limit = Math.min(Math.max(Math.round(options.limit ?? 25), 1), MAX_BATCH);
  const exclude = new Set(options.excludeLeadIds ?? []);

  const { data: convs, error } = await admin
    .from('conversations')
    .select('id, lead_id, started_at, leads!inner(id, name, status)')
    .eq('agent_id', agentId)
    .eq('is_sandbox', false)
    .not('leads.status', 'in', '(lost,won)')
    .order('started_at', { ascending: false })
    .limit(800);
  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const queue: Array<{ convId: string; lead: any }> = [];
  for (const row of convs ?? []) {
    const lead = oneLead((row as any).leads);
    if (!lead || seen.has(lead.id) || exclude.has(lead.id)) continue;
    seen.add(lead.id);
    queue.push({ convId: (row as any).id, lead });
  }

  let pool = queue;
  if (options.quick) {
    // Быстрый поиск: ИИ читает только диалоги, где клиент писал что-то похожее на отказ.
    const matched = await findConversationsWithRefusalWords(
      admin,
      queue.map((q) => q.convId),
    );
    pool = queue.filter((q) => matched.has(q.convId));
  }

  const batch = pool.slice(0, limit);
  const result: AnalyzeResult = {
    processedLeadIds: batch.map((b) => b.lead.id),
    verdicts: [],
    remaining: Math.max(pool.length - batch.length, 0),
    skippedNoReply: 0,
    failed: 0,
  };

  const work = async ({ convId, lead }: { convId: string; lead: any }) => {
    const { data: msgs } = await admin
      .from('messages')
      .select('sender, content, created_at')
      .eq('conversation_id', convId)
      .in('sender', ['user', 'ai', 'operator'])
      .order('created_at', { ascending: false })
      .limit(40);

    const ordered = [...(msgs ?? [])].reverse();
    const clientMessages = ordered.filter((m: any) => m.sender === 'user' && String(m.content ?? '').trim());
    if (clientMessages.length === 0) {
      result.skippedNoReply += 1;
      return;
    }

    const transcript = ordered
      .map((m: any) => `${m.sender === 'ai' ? 'Agent' : m.sender === 'user' ? 'Client' : 'Operator'}: ${String(m.content ?? '').replace(/\n/g, ' ').slice(0, 300)}`)
      .join('\n');

    try {
      const verdict = await classifyTranscript(transcript);
      if (!verdict) {
        result.failed += 1;
        return;
      }
      if (!verdict.lost) return;

      const lastClient = clientMessages[clientMessages.length - 1] as any;
      result.verdicts.push({
        leadId: lead.id,
        conversationId: convId,
        name: String(lead.name ?? '').trim() || 'Без имени',
        reason: verdict.reason,
        label: LOST_REASON_LABELS[verdict.reason],
        note: verdict.note,
        confidence: verdict.confidence,
        lastClientMessage: String(lastClient.content ?? '').replace(/\n/g, ' ').slice(0, 120),
        lostAt: String((ordered[ordered.length - 1] as any)?.created_at ?? new Date().toISOString()),
      });
    } catch (e) {
      console.warn('[lost-classifier] classification failed', e instanceof Error ? e.message : e);
      result.failed += 1;
    }
  };

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(batch.slice(i, i + CONCURRENCY).map(work));
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  result.verdicts.sort((a, b) => order[a.confidence] - order[b.confidence]);
  return result;
}

export interface ApplyItem {
  leadId: string;
  reason: string;
  note?: string;
  lostAt?: string;
}

// Применяет только то, что человек подтвердил в интерфейсе.
export async function applyLostVerdicts(
  admin: SupabaseClient,
  agentId: string,
  items: ApplyItem[],
): Promise<{ applied: number; skipped: number }> {
  const clean = items
    .map((item) => ({ ...item, reason: normalizeLostReason(item.reason) }))
    .filter((item): item is ApplyItem & { reason: LostReason } => Boolean(item.leadId) && item.reason !== null)
    .slice(0, 200);
  if (clean.length === 0) return { applied: 0, skipped: items.length };

  const ids = clean.map((c) => c.leadId);
  const { data: owned } = await admin
    .from('conversations')
    .select('lead_id, leads!inner(id, status)')
    .eq('agent_id', agentId)
    .in('lead_id', ids);

  const allowed = new Set<string>();
  for (const row of owned ?? []) {
    const lead = oneLead((row as any).leads);
    if (lead && lead.status !== 'lost' && lead.status !== 'won') allowed.add(lead.id);
  }

  const now = Date.now();
  let applied = 0;
  for (const item of clean) {
    if (!allowed.has(item.leadId)) continue;
    const parsed = item.lostAt ? new Date(item.lostAt).getTime() : NaN;
    const lostAt = Number.isFinite(parsed) && parsed <= now && parsed >= now - 366 * 86_400_000 ? new Date(parsed) : new Date(now);

    const { error } = await admin
      .from('leads')
      .update({
        status: 'lost',
        lost_reason: item.reason,
        lost_note: String(item.note ?? '').trim().slice(0, LOST_NOTE_MAX) || null,
        lost_at: lostAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.leadId);
    if (error) throw new Error(error.message);
    applied += 1;
  }
  return { applied, skipped: clean.length - applied };
}
