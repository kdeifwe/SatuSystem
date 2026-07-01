import { createAdminClient } from '@/lib/supabase/admin';

export async function sendTelegramText(channelId: string, externalId: string, content: string) {
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from('channels')
    .select('credentials')
    .eq('id', channelId)
    .single();

  if (error || !channel) {
    throw new Error('Telegram channel not found');
  }

  const token = typeof channel.credentials?.token === 'string' ? channel.credentials.token : '';
  if (!token || !externalId) {
    throw new Error('Telegram bot token or chat id is missing');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: externalId, text: content, parse_mode: 'HTML' }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? 'Telegram send failed');
  }
}
