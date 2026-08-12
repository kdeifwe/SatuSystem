import { NextRequest, NextResponse } from 'next/server';
import { notifyOrgAdmins } from '@/lib/notifications';
import { getSupabaseAdminClient } from '@/lib/supabase-server';
import { normalizeKaspiPhone } from '@/lib/kaspi-phone.ts';

export const runtime = 'nodejs';

const MAX_AUTO_INVOICE_AMOUNT = 200000;
const DEFAULT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 1000;
const DUPLICATE_INVOICE_WINDOW_MS = 60_000;
const SEND_DELAY_MS = 6000;

const INTERNAL_API_SECRET_HEADER = 'X-Internal-Secret';

type KaspiInvoiceRequestBody = {
  lead_id?: unknown;
  phone?: unknown;
  amount?: unknown;
  comment?: unknown;
  conversation_id?: unknown;
};

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildBasicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function isValidUuid(value: string | null | undefined) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractQrOperationId(responseBody: unknown): string | null {
  if (!responseBody || typeof responseBody !== 'object') {
    return null;
  }

  const bodyRecord = responseBody as Record<string, unknown>;
  const data = bodyRecord.Data;

  if (!data || typeof data !== 'object') {
    return null;
  }

  const qrOperationId = (data as Record<string, unknown>).QrOperationId;

  if (typeof qrOperationId === 'number' || typeof qrOperationId === 'string') {
    return String(qrOperationId);
  }

  return null;
}

export async function POST(req: NextRequest) {
  const incomingSecret = req.headers.get(INTERNAL_API_SECRET_HEADER);
  if (!process.env.INTERNAL_API_SECRET || incomingSecret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: KaspiInvoiceRequestBody;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const { lead_id, phone, amount, comment, conversation_id } = body;

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

    const normalizedAmount = typeof amount === 'string' ? Number(amount) : amount;
    const normalizedLeadId = typeof lead_id === 'string' && lead_id.trim() ? lead_id.trim() : null;
    const normalizedLeadIdForDb = isValidUuid(normalizedLeadId) ? normalizedLeadId : null;
    const normalizedConversationId = typeof conversation_id === 'string' && conversation_id.trim() ? conversation_id.trim() : null;
    const normalizedConversationIdForDb = isValidUuid(normalizedConversationId) ? normalizedConversationId : null;
    const normalizedComment = typeof comment === 'string' ? comment : null;
    const normalizedPhone = normalizeKaspiPhone(phone.trim());
    if (!/^[7]\d{10}$/.test(normalizedPhone)) {
      return NextResponse.json({ error: 'phone must be normalized to format 7XXXXXXXXXX' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    let organizationId: string | null = null;

    if (normalizedLeadIdForDb) {
      const { data: leadRecord, error: leadError } = await admin
        .from('leads')
        .select('org_id')
        .eq('id', normalizedLeadIdForDb)
        .maybeSingle();

      if (!leadError && leadRecord?.org_id) {
        organizationId = leadRecord.org_id;
      }
    }

    if (!organizationId) {
      const { data: organization, error: organizationError } = await admin
        .from('organizations')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (organizationError || !organization?.id) {
        return NextResponse.json({ error: 'Unable to resolve organization for kaspi invoice record' }, { status: 500 });
      }

      organizationId = organization.id;
    }

    const duplicateThreshold = new Date(Date.now() - DUPLICATE_INVOICE_WINDOW_MS).toISOString();
    let duplicateQuery = admin
      .from('kaspi_invoices')
      .select('*')
      .eq('org_id', organizationId)
      .eq('amount', normalizedAmount)
      .eq('phone', normalizedPhone)
      .in('status', ['pending', 'success'])
      .gt('created_at', duplicateThreshold)
      .order('created_at', { ascending: false })
      .limit(1);

    if (normalizedLeadIdForDb) {
      duplicateQuery = duplicateQuery.eq('lead_id', normalizedLeadIdForDb);
    }

    const { data: duplicateInvoice, error: duplicateQueryError } = await duplicateQuery.maybeSingle();
    if (duplicateQueryError) {
      console.error('[kaspi invoice] duplicate lookup failed', duplicateQueryError);
      return NextResponse.json({ error: 'Failed to verify duplicate invoice' }, { status: 500 });
    }

    if (duplicateInvoice) {
      return NextResponse.json(
        {
          success: true,
          duplicate: true,
          existing_invoice: {
            id: duplicateInvoice.id,
            kaspi_invoice_id: duplicateInvoice.kaspi_invoice_id,
            lead_id: duplicateInvoice.lead_id,
            conversation_id: duplicateInvoice.conversation_id,
            phone: duplicateInvoice.phone,
            amount: duplicateInvoice.amount,
            comment: duplicateInvoice.comment,
            status: duplicateInvoice.status,
            created_at: duplicateInvoice.created_at,
          },
        },
        { status: 200 },
      );
    }

    const { data: invoiceRecord, error: invoiceInsertError } = await admin
      .from('kaspi_invoices')
      .insert({
        org_id: organizationId,
        lead_id: normalizedLeadIdForDb,
        conversation_id: normalizedConversationIdForDb,
        phone: normalizedPhone,
        amount: normalizedAmount,
        comment: normalizedComment,
        status: 'pending',
        created_by: 'ai',
      })
      .select('id')
      .single();

    if (invoiceInsertError || !invoiceRecord?.id) {
      return NextResponse.json({ error: 'Failed to create kaspi invoice record', details: invoiceInsertError?.message }, { status: 500 });
    }

    const updateInvoiceRecord = async (updates: Record<string, unknown>) => {
      const { error } = await admin.from('kaspi_invoices').update(updates).eq('id', invoiceRecord.id);
      if (error) {
        throw error;
      }
    };

    const kaspiServiceUrl = process.env.KASPI_SERVICE_URL?.trim();
    const kaspiServiceUser = process.env.KASPI_SERVICE_USER?.trim();
    const kaspiServicePass = process.env.KASPI_SERVICE_PASS?.trim();

    if (!kaspiServiceUrl || !kaspiServiceUser || !kaspiServicePass) {
      await updateInvoiceRecord({ status: 'failed', error_message: 'KASPI_SERVICE_CONFIGURATION_MISSING' });
      return NextResponse.json(
        { error: 'KASPI_SERVICE_URL, KASPI_SERVICE_USER and KASPI_SERVICE_PASS must be configured' },
        { status: 500 },
      );
    }

    const kaspiUrl = `${kaspiServiceUrl.replace(/\/$/, '')}/api/invoice/create`;
    const payload = {
      phoneNumber: normalizedPhone,
      amount: normalizedAmount,
      comment: normalizedComment ?? '',
    };

    await sleep(SEND_DELAY_MS);

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
          await updateInvoiceRecord({ status: 'failed', error_message: 'KASPI_AUTH_EXPIRED' });
          try {
            await notifyOrgAdmins(
              organizationId,
              '⚠️ Сессия Kaspi Pay истекла — AI-агент не может выставлять счета.\n' +
                `Последняя попытка: lead_id ${normalizedLeadId ?? 'неизвестен'}.\n` +
                'Нужна реавторизация в Настройки → Интеграции → Kaspi Pay'
            );
          } catch (alertError) {
            console.error('[kaspi invoice] failed to notify org admins about auth expiry', alertError);
          }
          return NextResponse.json(
            {
              error: 'KASPI_AUTH_EXPIRED',
              message: 'Kaspi service rejected the invoice request with auth error',
              upstreamStatus: response.status,
              upstreamBody: responseBody,
              lead_id: normalizedLeadId,
            },
            { status: 502 },
          );
        }

        if (!response.ok) {
          await updateInvoiceRecord({ status: 'failed', error_message: 'KASPI_REQUEST_FAILED' });
          return NextResponse.json(
            {
              error: 'KASPI_REQUEST_FAILED',
              message: 'Kaspi service returned an error',
              upstreamStatus: response.status,
              upstreamBody: responseBody,
              lead_id: normalizedLeadId,
            },
            { status: 502 },
          );
        }

        const qrOperationId = extractQrOperationId(responseBody);
        if (!qrOperationId) {
          await updateInvoiceRecord({ status: 'failed', error_message: 'KASPI_RESPONSE_MISSING_QR_OPERATION_ID' });
          return NextResponse.json(
            {
              error: 'KASPI_REQUEST_FAILED',
              message: 'Kaspi service returned a response without a QR operation id',
              upstreamBody: responseBody,
              lead_id: normalizedLeadId,
            },
            { status: 502 },
          );
        }

        await updateInvoiceRecord({ kaspi_invoice_id: qrOperationId, status: 'pending' });

        return NextResponse.json({
          success: true,
          lead_id: normalizedLeadId,
          kaspi_invoice_id: qrOperationId,
          request: payload,
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

        try {
          await updateInvoiceRecord({
            status: 'failed',
            error_message: isTimeout ? 'KASPI_TIMEOUT' : 'KASPI_UNAVAILABLE',
          });
        } catch {
          // ignore follow-up DB update failure to preserve original bridge error
        }

        return NextResponse.json(
          {
            error: isTimeout ? 'KASPI_TIMEOUT' : 'KASPI_UNAVAILABLE',
            message: isTimeout ? 'Timed out while contacting Kaspi service' : message,
            lead_id: normalizedLeadId,
          },
          { status: 502 },
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return NextResponse.json({ error: 'Unexpected kaspi bridge error' }, { status: 500 });
  } catch (error) {
    return NextResponse.json({ error: 'Unexpected kaspi bridge error', details: toErrorMessage(error) }, { status: 500 });
  }
}
