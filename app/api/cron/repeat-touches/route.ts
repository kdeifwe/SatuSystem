import { NextRequest, NextResponse } from 'next/server';
import { runRepeatTouches } from '@/lib/server/follow-ups/worker';

const AUTH_HEADER = 'authorization';

export const dynamic = 'force-dynamic';

// Повторные касания (касание №2, №3 для замолчавших лидов).
// ?dry=1 — ничего не отправлять, только показать, кому и какое касание было бы отправлено.
export async function GET(req: NextRequest) {
  const token = req.headers.get(AUTH_HEADER)?.replace('Bearer ', '').trim();
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('dry') === '1';

  try {
    const result = await runRepeatTouches({ dryRun });
    return NextResponse.json({ ok: result.errors.length === 0, dryRun, ...result });
  } catch (e) {
    console.error('[repeat-touches cron] error', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
