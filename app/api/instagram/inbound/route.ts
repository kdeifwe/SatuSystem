import { NextRequest, NextResponse } from 'next/server';
import pino from 'pino';
import { verifyInstagramInboundSignature } from '@/lib/server/instagram-inbound-signature';
import { parseInstagramInboundPayload, processInstagramInbound } from '@/lib/server/instagram-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = pino({ level: process.env.NODE_ENV === 'development' ? 'info' : 'warn' });

/**
 * Входящие сообщения от ig-worker. Отвечаем сразу (200), обработка идёт в фоне:
 * Next запущен как постоянный Node-процесс (Railway), поэтому фоновая работа не обрывается.
 * Повторная доставка безопасна: дедупликация идёт по unique-индексу messages.external_message_id.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const valid = verifyInstagramInboundSignature({
    rawBody,
    signature: req.headers.get('x-ig-signature'),
    timestamp: req.headers.get('x-ig-timestamp'),
    secret: process.env.IG_WORKER_SECRET,
  });
  if (!valid) {
    logger.warn('Instagram inbound rejected: invalid signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const payload = parseInstagramInboundPayload(json);
  if (!payload) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  void processInstagramInbound(payload).catch((error) => {
    logger.error({ errorName: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error) }, 'Instagram inbound processing crashed');
  });

  return NextResponse.json({ ok: true });
}
