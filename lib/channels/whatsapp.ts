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
      // Try to find matching channel by phoneNumberId in credentials, fallback to first active whatsapp channel
      const { data: channels } = await admin.from('channels').select('id, credentials').eq('type', 'whatsapp');
      let channelId = null;
      for (const ch of (channels ?? [])) {
        try {
          const cred = ch.credentials || {};
          if (cred?.phoneNumberId == phoneNumberId || cred?.phone_number_id == phoneNumberId) {
            channelId = ch.id;
            break;
          }
        } catch (e) {}
      }
      // fallback to first channel if none matched
      if (!channelId && Array.isArray(channels) && channels.length > 0) channelId = channels[0].id;
      const { data: existing } = await admin.from('channel_error_counters').select('consecutive_errors').eq('channel_id', channelId).maybeSingle();
      const prev = existing?.consecutive_errors ?? 0;
      const next = prev + 1;
      await admin.from('channel_error_counters').upsert({ channel_id: channelId, consecutive_errors: next, last_error_at: new Date(), last_error_message: errText, updated_at: new Date().toISOString() });
      try { await admin.from('channel_error_counters').update({ updated_at: new Date().toISOString() }).eq('channel_id', channelId); } catch (e) {}
      if (next >= 3) {
        await admin.from('notification_log').insert({
          org_id: null,
          agent_id: null,
          lead_id: null,
          event_type: 'channel_down',
          payload: { channel_type: 'whatsapp', channel_name: 'WhatsApp', error_message: errText, time: new Date() },
          delivery_status: 'pending'
        });
        await admin.from('channel_error_counters').update({ consecutive_errors: 0, updated_at: new Date().toISOString() }).eq('channel_id', channelId);
        try { await admin.from('channel_error_counters').update({ updated_at: new Date().toISOString() }).eq('channel_id', channelId); } catch (e) {}
      }
    } catch (e) {
      console.error('[whatsapp] failed to update channel_error_counters', e);
    }

    throw new Error(`WhatsApp send error: ${errText}`);
  }
}
