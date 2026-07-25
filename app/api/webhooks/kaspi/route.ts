import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-server';
import { getKaspiWebhookStatusUpdate, verifyKaspiWebhookSignature } from '@/lib/server/kaspi-webhook';

export const runtime = 'nodejs';

type KaspiWebhookPayload = {
  event?: unknown;
  paymentId?: unknown;
};

function parsePayload(rawBody: string): KaspiWebhookPayload | null {
  try {
    return JSON.parse(rawBody) as KaspiWebhookPayload;
  } catch {
    return null;
  }
}

async function processWebhook(payload: KaspiWebhookPayload | null) {
  if (!payload || typeof payload.paymentId !== 'string' || !payload.paymentId.trim()) {
    return;
  }

  const updateSpec = getKaspiWebhookStatusUpdate(typeof payload.event === 'string' ? payload.event : null);
  if (!updateSpec) {
    return;
  }

  const admin = getSupabaseAdminClient();
  const updatePayload: Record<string, unknown> = { status: updateSpec.status };

  if (updateSpec.paidAt) {
    updatePayload.paid_at = new Date().toISOString();
  }

  const { error } = await admin
    .from('kaspi_invoices')
    .update(updatePayload)
    .eq('kaspi_invoice_id', payload.paymentId.trim())
    .eq('status', 'pending');

  if (error) {
    console.error('[kaspi webhook] failed to update invoice status', {
      paymentId: payload.paymentId,
      event: payload.event,
      error,
    });
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-webhook-signature');
  const secret = process.env.KASPI_WEBHOOK_SECRET;

  if (!verifyKaspiWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = parsePayload(rawBody);

  void processWebhook(payload).catch((error) => {
    console.error('[kaspi webhook] processing failed', error);
  });

  return NextResponse.json({ received: true }, { status: 200 });
}
