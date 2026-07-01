import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { generateAgentPrompt } from '@/lib/server/ai/prompt-generator';

export async function POST(
  req: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const body = await req.json();
    const { agentName, companyName, companyDescription, goal, advantages, currency, timezone, writingStyle, addressStyle } = body;

    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: kbSources } = await admin
      .from('kb_sources')
      .select('raw_content, title')
      .eq('agent_id', params.agentId)
      .eq('status', 'done')
      .limit(3);

    const kbTexts = (kbSources ?? [])
      .map((s) => `[${s.title}]\n${(s.raw_content ?? '').slice(0, 1000)}`)
      .filter(Boolean);

    const generated = await generateAgentPrompt(
      {
        agentName,
        companyName,
        companyDescription,
        goal,
        advantages,
        currency,
        timezone,
        writingStyle,
        addressStyle,
      },
      kbTexts
    );

    const { error: updateError } = await admin
      .from('agents')
      .update({
        name: agentName,
        role: generated.role,
        goal: generated.goal,
        tone_of_voice: generated.tone_of_voice,
        human_communication_style: generated.human_communication_style,
        communication_rules: generated.communication_rules,
        knowledge_base_principles: generated.knowledge_base_principles,
        system_prompt_compiled: generated.system_prompt_compiled,
      })
      .eq('id', params.agentId);

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 200 });
    }

    const { data: membership } = await admin
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .single();

    if (membership) {
      await admin.from('organizations').update({
        name: companyName,
        currency,
        timezone,
      }).eq('id', membership.org_id);
    }

    return NextResponse.json({ success: true, generated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[generate-prompt] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 200 });
  }
}
