import { NextRequest } from 'next/server';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from '@/lib/server/whatsapp-webhook';

export async function GET(req: NextRequest) {
  return verifyWhatsAppWebhook(req);
}

export async function POST(req: NextRequest) {
  return handleWhatsAppWebhook(req);
}
