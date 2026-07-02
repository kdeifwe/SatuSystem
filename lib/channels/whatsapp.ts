import { createClient } from '@supabase/supabase-js';

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string,
): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errText = JSON.stringify(errBody);
    try {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: existing } = await admin.from('channel_error_counters').select('consecutive_errors').eq('channel_type', 'whatsapp').maybeSingle();
      const prev = existing?.consecutive_errors ?? 0;
      const next = prev + 1;
      await admin.from('channel_error_counters').upsert({ channel_type: 'whatsapp', consecutive_errors: next, last_error_at: new Date() });
      if (next >= 3) {
        await admin.from('notification_log').insert({
          org_id: null,
          agent_id: null,
          lead_id: null,
          event_type: 'channel_down',
          payload: { channel_type: 'whatsapp', channel_name: 'WhatsApp', error_message: errText, time: new Date() },
          delivery_status: 'pending'
        });
        await admin.from('channel_error_counters').update({ consecutive_errors: 0 }).eq('channel_type', 'whatsapp');
      }
    } catch (e) {
      console.error('[whatsapp] failed to update channel_error_counters', e);
    }

    throw new Error(`WhatsApp send error: ${errText}`);
  }
}
