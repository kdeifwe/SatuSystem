'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';

type WhatsAppSaveState = {
  success?: boolean;
  error?: string;
  webhookUrl?: string;
  verifyToken?: string;
};

export async function saveWhatsAppSettings(
  _prevState: WhatsAppSaveState | null,
  formData: FormData,
): Promise<WhatsAppSaveState> {
  const agentId = formData.get('agentId')?.toString().trim();
  const phoneNumberId = formData.get('phone_number_id')?.toString().trim();
  const accessToken = formData.get('access_token')?.toString().trim();
  const appSecret = formData.get('app_secret')?.toString().trim();
  const webhookVerifyToken = formData.get('webhook_verify_token')?.toString().trim();

  if (!agentId || !phoneNumberId || !accessToken || !appSecret || !webhookVerifyToken) {
    return { error: 'Все поля обязательны' };
  }

  try {
    const admin = createAdminClient();
    const { data: agent, error: agentError } = await admin
      .from('agents')
      .select('org_id')
      .eq('id', agentId)
      .single();

    if (agentError || !agent?.org_id) {
      return { error: 'Агент не найден' };
    }

    const credentials = {
      phone_number_id: phoneNumberId,
      access_token: accessToken,
      app_secret: appSecret,
      webhook_verify_token: webhookVerifyToken,
    };

    const { data: existingChannel } = await admin
      .from('channels')
      .select('id')
      .eq('org_id', agent.org_id)
      .eq('type', 'whatsapp')
      .maybeSingle();

    if (existingChannel?.id) {
      await admin
        .from('channels')
        .update({ credentials, is_active: true })
        .eq('id', existingChannel.id);
    } else {
      await admin.from('channels').insert({
        org_id: agent.org_id,
        type: 'whatsapp',
        credentials,
        is_active: true,
      });
    }

    revalidatePath(`/dashboard/${agentId}/integrations`);

    return {
      success: true,
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'}/api/webhooks/whatsapp`,
      verifyToken: webhookVerifyToken,
    };
  } catch (error) {
    console.error('[whatsapp save]', error);
    return { error: 'Не удалось сохранить настройки WhatsApp' };
  }
}
