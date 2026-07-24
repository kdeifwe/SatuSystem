import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_AUTO_INVOICE_AMOUNT = 50000;
const DEFAULT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1000;

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildBasicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  let body: { lead_id?: string; phone?: unknown; amount?: unknown; comment?: unknown };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { lead_id, phone, amount, comment } = body;

  if (typeof phone !== 'string' || !phone.trim()) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 });
  }

  if (typeof amount === 'string') {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    if (parsedAmount > MAX_AUTO_INVOICE_AMOUNT) {
      return NextResponse.json(
        { error: 'amount exceeds MAX_AUTO_INVOICE_AMOUNT', maxAmount: MAX_AUTO_INVOICE_AMOUNT },
        { status: 400 },
      );
    }
  } else if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }

    if (amount > MAX_AUTO_INVOICE_AMOUNT) {
      return NextResponse.json(
        { error: 'amount exceeds MAX_AUTO_INVOICE_AMOUNT', maxAmount: MAX_AUTO_INVOICE_AMOUNT },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json({ error: 'amount is required' }, { status: 400 });
  }

  const kaspiServiceUrl = process.env.KASPI_SERVICE_URL?.trim();
  const kaspiServiceUser = process.env.KASPI_SERVICE_USER?.trim();
  const kaspiServicePass = process.env.KASPI_SERVICE_PASS?.trim();

  if (!kaspiServiceUrl || !kaspiServiceUser || !kaspiServicePass) {
    return NextResponse.json(
      { error: 'KASPI_SERVICE_URL, KASPI_SERVICE_USER and KASPI_SERVICE_PASS must be configured' },
      { status: 500 },
    );
  }

  const normalizedAmount = typeof amount === 'string' ? Number(amount) : amount;
  const kaspiUrl = `${kaspiServiceUrl.replace(/\/$/, '')}/api/invoice/create`;
  const payload = {
    phoneNumber: phone.trim(),
    amount: normalizedAmount,
    comment: typeof comment === 'string' ? comment : '',
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: buildBasicAuthHeader(kaspiServiceUser, kaspiServicePass),
  };

  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(kaspiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let responseBody: unknown = null;

      try {
        responseBody = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseBody = responseText;
      }

      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          {
            error: 'KASPI_AUTH_EXPIRED',
            message: 'Kaspi service rejected the invoice request with auth error',
            upstreamStatus: response.status,
            upstreamBody: responseBody,
            lead_id,
          },
          { status: 502 },
        );
      }

      if (!response.ok) {
        return NextResponse.json(
          {
            error: 'KASPI_REQUEST_FAILED',
            message: 'Kaspi service returned an error',
            upstreamStatus: response.status,
            upstreamBody: responseBody,
            lead_id,
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        success: true,
        lead_id,
        request: payload,
        kaspiResponse: responseBody,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      const isTimeout = error instanceof Error && error.name === 'AbortError';

      if (attempt === 0 && isTimeout) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      return NextResponse.json(
        {
          error: isTimeout ? 'KASPI_TIMEOUT' : 'KASPI_UNAVAILABLE',
          message: isTimeout ? 'Timed out while contacting Kaspi service' : message,
          lead_id,
        },
        { status: 502 },
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return NextResponse.json({ error: 'Unexpected kaspi bridge error' }, { status: 500 });
}
