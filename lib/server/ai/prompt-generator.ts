import { BusinessInfo, GeneratedPrompt } from './types';
import { BASE_POLICY } from '../../ai/base-policy.ts';

async function callGemini(apiKey: string, prompt: string, temp = 0.7): Promise<string> {
  const models = ['gemini-2.0-flash', 'gemini-2.5-pro'];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: temp, maxOutputTokens: 8192 },
          }),
        }
      );
      if (!res.ok) {
        console.warn(`[prompt-gen] ${model} ${res.status}`);
        continue;
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (text.length > 50) return text;
    } catch (e) {
      console.warn(`[prompt-gen] ${model} error:`, e);
    }
  }
  throw new Error('Все модели Gemini недоступны');
}

function extractJSON(text: string): Record<string, any> {
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`JSON не найден: ${text.slice(0, 200)}`);
  return JSON.parse(clean.slice(start, end + 1));
}

export type { BusinessInfo, GeneratedPrompt } from './types';

export async function generateAgentPrompt(
  info: BusinessInfo,
  kbSources: string[],
): Promise<GeneratedPrompt> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY не задан');

  const analysisPrompt = `You are a world-class CIS market sales psychologist and AI agent architect.

BUSINESS DATA:
- Agent name: ${info.agentName}
- Company: ${info.companyName}
- Description: ${info.companyDescription}
- Goal: ${info.goal}
- Key advantages: ${info.advantages}
- Currency: ${info.currency} | Timezone: ${info.timezone}
- Writing style: ${info.writingStyle} | Address form: ${info.addressStyle}

${kbSources.length > 0 ? `KNOWLEDGE BASE:\n${kbSources.slice(0, 3).join('\n---\n')}` : ''}

STEP 1 - Deeply analyze:
1. WHO is the typical buyer? Age, job, pain points, fears, desires
2. WHAT objections will they raise? Price, trust, urgency, alternatives
3. WHAT emotional triggers drive them to buy?
4. WHAT language do they use? Formal/casual, local slang?

Return raw JSON only (no markdown, start with {):
{
  "target_audience": "detailed ICP: who, age range, main pain points",
  "top_objections": ["objection1", "objection2", "objection3", "objection4", "objection5"],
  "emotional_triggers": ["trigger1", "trigger2", "trigger3"],
  "language_style": "how this audience actually talks in messengers",
  "trust_signals": ["what builds trust with this audience"]
}`;

  console.log('[prompt-gen] Step 1: Analyzing business...');
  const analysisText = await callGemini(apiKey, analysisPrompt, 0.4);
  const analysis = extractJSON(analysisText);

  const generationPrompt = `You are an expert AI prompt engineer specializing in HUMAN-LIKE sales agents for CIS market.

BUSINESS PROFILE:
- Agent: ${info.agentName} at ${info.companyName}
- Goal: ${info.goal}
- Style: ${info.writingStyle}, ${info.addressStyle}

AUDIENCE ANALYSIS:
- Target: ${analysis.target_audience}
- Top objections: ${JSON.stringify(analysis.top_objections)}
- Emotional triggers: ${JSON.stringify(analysis.emotional_triggers)}
- Their language: ${analysis.language_style}
- Trust signals: ${JSON.stringify(analysis.trust_signals)}

${kbSources.length > 0 ? `PRODUCT KNOWLEDGE:\n${kbSources.slice(0, 2).join('\n---\n')}` : ''}

Create a PERFECT agent profile for a human-like sales/support messenger assistant.

CRITICAL HUMAN-LIKE RULES TO EMBED:
- Messages should read like a real person in chat: 1-2 sentences, no paragraphs.
- One question per message only.
- Mirror client energy and use natural, varied length.
- Never use bullet points or numbered lists in chat output.
- Avoid formulaic openers and closers.
- Handle objections naturally and focus on the client’s concern.

Return raw JSON only (no markdown, start with {):
{
  "role": "one sentence role in Russian",
  "goal": "specific measurable goal in Russian",
  "tone_of_voice": "detailed tone description with 3 concrete examples of phrases",
  "human_communication_style": "7 specific rules for sounding human. Include: message length, emoji usage, fillers, mirroring, acknowledgment patterns",
  "communication_rules": "10 numbered rules specific to THIS business. Cover objections: ${(analysis.top_objections as string[]).slice(0, 3).join(', ')}. Include price handling, urgency, trust building, escalation",
  "knowledge_base_principles": "5 rules for KB usage: when to search, how to handle missing info, how to cite, when to say 'не знаю', when to escalate",
  "dialogue_flow": "8 steps for complete sales script. Each step: trigger → what agent says (example phrase) → what to listen for → next step trigger",
  "forbidden_phrases": "10 phrases agent must NEVER say (corporate speak, robotic phrases)",
  "example_conversations": "3 short example exchanges showing ideal human-like responses vs bad robotic responses"
}`;

  console.log('[prompt-gen] Step 2: Generating human-like prompt...');
  const generationText = await callGemini(apiKey, generationPrompt, 0.6);
  const generated = extractJSON(generationText);

  const system_prompt_compiled = `${BASE_POLICY}

<role>
Ты ${info.agentName} — ${generated.role} в компании ${info.companyName}.
Ты живой человек, менеджер. Никогда не признавайся, что ты ИИ, если не спросили напрямую.
</role>

<goal>
${generated.goal}
</goal>

<location_context>
Часовой пояс: ${info.timezone}. Валюта: ${info.currency}.
</location_context>

<tone_of_voice>
${generated.tone_of_voice}
</tone_of_voice>

<human_communication_style>
${generated.human_communication_style}
</human_communication_style>

<communication_rules>
${generated.communication_rules}
</communication_rules>

<target_audience>
${analysis.target_audience}
Типичные возражения клиентов: ${(analysis.top_objections as string[]).join('; ')}
Что их мотивирует: ${(analysis.emotional_triggers as string[]).join('; ')}
</target_audience>

<knowledge_base_principles>
${generated.knowledge_base_principles}
</knowledge_base_principles>

<dialogue_flow>
${generated.dialogue_flow}
</dialogue_flow>

<forbidden>
НИКОГДА не говори: ${generated.forbidden_phrases}
НИКОГДА не используй маркированные списки в чате.
НИКОГДА не пиши более 3 предложений подряд.
НИКОГДА не начинай каждое сообщение с приветствия.
</forbidden>

<examples>
${generated.example_conversations}
</examples>

<tools_calling_instructions>
searchKnowledgeBase — перед любым фактическим утверждением о цене/наличии/условиях.
redirectToOperator — при жалобе, явной просьбе о человеке, или если не можешь помочь.
update_lead_info — когда клиент назвал имя, телефон, email.
add_lead_note — важная деталь для команды.
Не вызывай инструменты без явного повода в диалоге.
</tools_calling_instructions>`;

  return {
    system_prompt_compiled,
    role: generated.role || '',
    goal: generated.goal || '',
    tone_of_voice: generated.tone_of_voice || '',
    human_communication_style: generated.human_communication_style || '',
    communication_rules: generated.communication_rules || '',
    knowledge_base_principles: generated.knowledge_base_principles || '',
    dialogue_flow: generated.dialogue_flow || '',
  };
}
