import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { compileAndSaveSystemPromptForOrganization } from '@/lib/ai/compile-system-prompt';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Организация не найдена' }, { status: 400 });
  }

  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, timezone, currency, agent_defaults')
    .eq('id', membership.org_id)
    .single();

  return NextResponse.json({ organization });
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'Организация не найдена' }, { status: 400 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if ('name' in body) updates.name = body.name;
  if ('timezone' in body) updates.timezone = body.timezone;
  if ('currency' in body) updates.currency = body.currency;
  if ('agent_defaults' in body) updates.agent_defaults = body.agent_defaults;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Нет данных для обновления' }, { status: 400 });
  }

  const { error } = await supabase.from('organizations').update(updates).eq('id', membership.org_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await compileAndSaveSystemPromptForOrganization(membership.org_id);
  return NextResponse.json({ success: true });
}
