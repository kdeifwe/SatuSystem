import { BusinessInfo, GeneratedPrompt } from './types';
import { BASE_POLICY } from '../../ai/base-policy.ts';
import { llmClient } from './llm-client';

// Use unified llmClient for prompt generation (OpenAI path preferred)

function repairJsonText(candidate: string): string {
  let repaired = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      repaired += '\\';
      escaped = true;
      continue;
    }

    if (char === '"') {
      if (inString) {
        repaired += '\\"';
      } else {
        repaired += '"';
        inString = true;
      }
      continue;
    }

    if (inString) {
      if (char === '\n') {
        repaired += '\\n';
      } else if (char === '\r') {
        repaired += '\\r';
      } else if (char === '\t') {
        repaired += '\\t';
      } else {
        repaired += char;
      }
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function extractJSON(text: string): Record<string, any> {
  let extractedText = text;

  // Удаляем markdown блоки (```json ... ``` или ``` ... ```)
  const markdownMatch = extractedText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (markdownMatch) {
    extractedText = markdownMatch[1];
  }

  let inString = false;
  let escaped = false;

  for (let index = 0; index < extractedText.length; index += 1) {
    const char = extractedText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char !== '{') {
      continue;
    }

    let depth = 0;
    let candidateInString = false;
    let candidateEscaped = false;

    for (let cursor = index; cursor < extractedText.length; cursor += 1) {
      const candidateChar = extractedText[cursor];

      if (candidateEscaped) {
        candidateEscaped = false;
        continue;
      }

      if (candidateChar === '\\') {
        candidateEscaped = true;
        continue;
      }

      if (candidateChar === '"') {
        candidateInString = !candidateInString;
        continue;
      }

      if (candidateInString) {
        continue;
      }

      if (candidateChar === '{') {
        depth += 1;
      } else if (candidateChar === '}') {
        depth -= 1;
        if (depth === 0) {
          const jsonText = extractedText.slice(index, cursor + 1);
          try {
            return JSON.parse(repairJsonText(jsonText));
          } catch (parseError) {
            console.error('[prompt-generator] JSON.parse failed:', parseError instanceof Error ? parseError.message : String(parseError));
            break;
          }
        }
      }
    }
  }

  const trimmedText = extractedText.trim();
  if (trimmedText.startsWith('{') && trimmedText.endsWith('}')) {
    try {
      console.warn('[prompt-generator] Falling back to direct JSON.parse because balanced object scan did not yield a parseable payload');
      return JSON.parse(trimmedText);
    } catch (parseError) {
      console.error('[prompt-generator] Direct JSON.parse failed:', parseError instanceof Error ? parseError.message : String(parseError));
    }
  }

  console.error('[prompt-generator] extractJSON failed - no JSON object balanced');
  throw new Error(`JSON не найден: ${text.slice(0, 200)}`);
}

async function generateStructuredJson(
  model: string,
  prompt: string,
  temp: number,
  maxOutputTokens = 32768,
): Promise<Record<string, any>> {
  try {
    const resp = await llmClient.generate({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: temp,
      maxTokens: maxOutputTokens,
    });
    const text = resp.text ?? '';

    try {
      return extractJSON(text);
    } catch (error) {
      const firstError = error instanceof Error ? error : new Error(String(error));
      const trimmedText = text.trim();
      const textLooksTruncated = trimmedText.length > 0 && !trimmedText.endsWith('}');

      if (!textLooksTruncated) {
        throw firstError;
      }

      console.warn('[prompt-generator] LLM response looked truncated, retrying once with a stricter JSON instruction');
      const retryPrompt = `${prompt}\n\nPrevious response was truncated. Return ONLY the complete JSON object, no extra text.`;
      const retried = await llmClient.generate({
        model,
        messages: [{ role: 'user', content: retryPrompt }],
        temperature: 0.3,
        maxTokens: maxOutputTokens,
      });

      try {
        return extractJSON(retried.text ?? '');
      } catch (retryError) {
        throw firstError;
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export type { BusinessInfo, GeneratedPrompt } from './types';

function buildChannelContext(info: BusinessInfo): string {
  const enabled = Object.entries(info.channels.enabled)
    .filter(([, enabled]) => enabled)
    .map(([channel]) => channel);

  if (enabled.length === 0) {
    return 'Каналы: не указан ни один канал. Агент должен вести себя как универсальный помощник в чате.';
  }

  return `Каналы коммуникации: ${enabled.join(', ')}. В ответах учитывай естественный стиль для этих каналов и избегай перегружать текст.`;
}

function buildBehaviorContext(info: BusinessInfo): string {
  const toolNames = info.behavior.allowedTools.join(', ') || 'нет дополнительных инструментов';
  const handoffTriggers = info.behavior.handoffTriggers.length > 0 ? info.behavior.handoffTriggers.join(', ') : 'нет специальных триггеров';
  const neverSay = info.behavior.neverSayPhrases.length > 0 ? info.behavior.neverSayPhrases.join(', ') : 'нет специальных запретов';

  return `Операционные правила: задержка ответа ${info.behavior.responseDelayMs} мс; follow-up ${info.behavior.followUpEnabled ? 'включён' : 'выключен'}; разрешённые инструменты: ${toolNames}; триггеры передачи оператору: ${handoffTriggers}; не говорить: ${neverSay}`;
}

function buildFunnelContext(info: BusinessInfo): string {
  if (info.funnel.steps.length === 0) {
    return 'Фуннел не задан. Используй общую логику приветствия, уточнения, предложения и закрытия.';
  }

  return `Стадии диалога:\n${info.funnel.steps
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((step) => `- ${step.order}. ${step.title}: ${step.triggerDescription || '—'} | Пример сообщения: ${step.sampleMessage || '—'}`)
    .join('\n')}`;
}

function inferScenarioTemperature(scenario: BusinessInfo['business']['scenario']): number {
  switch (scenario) {
    case 'support':
      return 0.7;
    case 'consultant':
      return 0.55;
    case 'sales':
    default:
      return 0.4;
  }
}

export async function generateAgentPrompt(
  info: BusinessInfo,
  kbSources: string[],
): Promise<GeneratedPrompt> {
  const effectiveAdvanced = {
    model: info.advanced?.model || (process.env.FALLBACK_LLM_MODEL ?? 'gemini-3.5-flash'),
    temperature: typeof info.advanced?.temperature === 'number' ? info.advanced.temperature : inferScenarioTemperature(info.business.scenario),
    topP: typeof info.advanced?.topP === 'number' ? info.advanced.topP : 0.9,
  };

  const analysisPrompt = `You are a world-class CIS market sales psychologist and AI agent architect.

BUSINESS DATA:
- Agent name: ${info.agentName}
- Company: ${info.companyName}
- Description: ${info.companyDescription}
- Goal: ${info.goal}
- Key advantages: ${info.advantages}
- Scenario: ${info.business.scenario}
- Target audience: ${info.business.targetAudience}
- First question: ${info.business.firstQuestion}
- Common objections: ${info.business.commonObjections.join(', ') || 'none'}
- Currency: ${info.currency} | Timezone: ${info.timezone}
- Writing style: ${info.writingStyle} | Address form: ${info.addressStyle}
- Channels: ${Object.entries(info.channels.enabled).filter(([, enabled]) => enabled).map(([channel]) => channel).join(', ') || 'none'}

${kbSources.length > 0 ? `KNOWLEDGE BASE:\n${kbSources.slice(0, 3).join('\n---\n')}` : ''}

STEP 1 - Deeply analyze:
1. WHO is the typical buyer? Age, job, pain points, fears, desires
2. WHAT objections will they raise? Price, trust, urgency, alternatives
3. WHAT emotional triggers drive them to buy?
4. WHAT language do they use? Formal/casual, local slang?
5. Which funnel stages are most natural for this business and which tools are likely needed?

Return raw JSON only (no markdown, start with {):
{
  "target_audience": "detailed ICP: who, age range, main pain points",
  "top_objections": ["objection1", "objection2", "objection3", "objection4", "objection5"],
  "emotional_triggers": ["trigger1", "trigger2", "trigger3"],
  "language_style": "how this audience actually talks in messengers",
  "trust_signals": ["what builds trust with this audience"],
  "funnelStageSuggestions": ["stage1", "stage2", "stage3"],
  "recommendedTools": ["searchKnowledgeBase", "redirectToOperator"]
}`;

  console.log('[prompt-gen] Step 1: Analyzing business...');
  const analysis = await generateStructuredJson(effectiveAdvanced.model, analysisPrompt, 0.4);

  const generationPrompt = `You are an expert AI prompt engineer specializing in HUMAN-LIKE sales agents for CIS market.

BUSINESS PROFILE:
- Agent: ${info.agentName} at ${info.companyName}
- Goal: ${info.goal}
- Style: ${info.writingStyle}, ${info.addressStyle}
- Scenario: ${info.business.scenario}
- First question: ${info.business.firstQuestion}
- Common objections: ${JSON.stringify(info.business.commonObjections)}

AUDIENCE ANALYSIS:
- Target: ${analysis.target_audience}
- Top objections: ${JSON.stringify(analysis.top_objections)}
- Emotional triggers: ${JSON.stringify(analysis.emotional_triggers)}
- Their language: ${analysis.language_style}
- Trust signals: ${JSON.stringify(analysis.trust_signals)}

${kbSources.length > 0 ? `PRODUCT KNOWLEDGE:\n${kbSources.slice(0, 2).join('\n---\n')}` : ''}

Create a PERFECT agent profile for a human-like sales/support messenger assistant.

CRITICAL HUMAN-LIKE RULES TO EMBED:
- Keep all text fields concise. Do not write long paragraphs. Return compact JSON.
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
  "dialogue_flow": [{"id": "welcome", "title": "Приветствие", "triggerDescription": "клиент открыл чат", "sampleMessage": "Здравствуйте!", "order": 1}, {"id": "qualify", "title": "Уточнение потребности", "triggerDescription": "клиент ответил на первое сообщение", "sampleMessage": "Что вам нужно?", "order": 2}],
  "recommended_handoff_triggers": ["жалоба", "просьба к человеку", "недостаточно данных"],
  "recommended_tools": ["searchKnowledgeBase", "redirectToOperator"],
  "forbidden_phrases": "10 phrases agent must NEVER say (corporate speak, robotic phrases)",
  "example_conversations": "3 short example exchanges showing ideal human-like responses vs bad robotic responses"
}`;

  console.log('[prompt-gen] Step 2: Generating human-like prompt...');
  const generated = await generateStructuredJson(effectiveAdvanced.model, generationPrompt, effectiveAdvanced.temperature);

  const funnelSteps = Array.isArray(generated.dialogue_flow) && generated.dialogue_flow.length > 0
    ? generated.dialogue_flow.map((step: any, index: number) => ({
        id: String(step.id || `step-${index + 1}`),
        title: String(step.title || `Шаг ${index + 1}`),
        triggerDescription: String(step.triggerDescription || ''),
        sampleMessage: String(step.sampleMessage || ''),
        order: Number(step.order || index + 1),
      }))
    : info.funnel.steps.length > 0
      ? info.funnel.steps.map((step, index) => ({ ...step, order: step.order || index + 1 }))
      : [
          { id: 'welcome', title: 'Приветствие', triggerDescription: 'клиент открыл чат', sampleMessage: 'Здравствуйте!', order: 1 },
          { id: 'qualify', title: 'Уточнение потребности', triggerDescription: 'клиент ответил', sampleMessage: 'Что вам нужно?', order: 2 },
          { id: 'offer', title: 'Предложение решения', triggerDescription: 'есть потребность', sampleMessage: 'Могу помочь с этим', order: 3 },
        ];

  const recommendedTools = Array.isArray(generated.recommended_tools) && generated.recommended_tools.length > 0
    ? generated.recommended_tools.filter((tool: unknown): tool is string => typeof tool === 'string')
    : (info.behavior.allowedTools.length > 0 ? info.behavior.allowedTools : []);

  const recommendedHandoffTriggers = Array.isArray(generated.recommended_handoff_triggers) && generated.recommended_handoff_triggers.length > 0
    ? generated.recommended_handoff_triggers.filter((value: unknown): value is string => typeof value === 'string')
    : info.behavior.handoffTriggers;

  const system_prompt_compiled = `${BASE_POLICY}

<role>
Ты ${info.agentName} — ${generated.role} в компании ${info.companyName}.
Ты живой человек, менеджер. Никогда не признавайся, что ты ИИ, если не спросили напрямую.
</role>

<goal>
${generated.goal}
</goal>

<business_context>
Сценарий: ${info.business.scenario}. Цель агента: ${info.goal || 'помогать клиентам'}.
Аудитория: ${info.business.targetAudience || analysis.target_audience || 'клиент'}.
Первый вопрос: ${info.business.firstQuestion || 'Какой у вас запрос сегодня?'}.
Типичные возражения: ${info.business.commonObjections.join(', ') || (analysis.top_objections as string[]).join(', ')}.
</business_context>

<channel_context>
${buildChannelContext(info)}
</channel_context>

<funnel_steps>
${buildFunnelContext({ ...info, funnel: { steps: funnelSteps } })}
</funnel_steps>

<location_context>
Часовой пояс: ${info.timezone}. Валюта: ${info.currency}. Модель: ${effectiveAdvanced.model}. Температура: ${effectiveAdvanced.temperature}. Top P: ${effectiveAdvanced.topP}.
</location_context>

<tone_of_voice>
${generated.tone_of_voice}
</tone_of_voice>

<human_communication_style>
${generated.human_communication_style}
</human_communication_style>

<communication_rules>
${generated.communication_rules}
Если клиент назвал класс обучения (например "он бір", "9 сыныпта", "11 класс"), немедленно вызови update_lead_info и сохрани число класса в attributes.grade, прежде чем отвечать дальше.
</communication_rules>

<target_audience>
${analysis.target_audience}
Типичные возражения клиентов: ${(analysis.top_objections as string[]).join('; ')}
Что их мотивирует: ${(analysis.emotional_triggers as string[]).join('; ')}
</target_audience>

<knowledge_base_principles>
${generated.knowledge_base_principles}
Если searchKnowledgeBase вернул чанк, который относится к другому классу/программе, чем указано в attributes.grade клиента, не используй его.
Если найден чанк без явной привязки к классу (общий) или точно совпадающий с классом клиента, используй его напрямую, с фактическими цифрами.
Никогда не отвечай "уточню у коллег", если запрошенный факт реально есть в найденном контексте — используй его.
</knowledge_base_principles>

<behavior_context>
${buildBehaviorContext({ ...info, behavior: { ...info.behavior, handoffTriggers: recommendedHandoffTriggers } })}
</behavior_context>

<handoff_rules>
Триггеры передачи оператору: ${recommendedHandoffTriggers.join(', ') || 'нет специальных триггеров'}.
Никогда не говори: ${info.behavior.neverSayPhrases.join(', ') || 'нет специальных запретов'}.
</handoff_rules>

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
createKaspiInvoice — когда клиент явно подтвердил готовность оплатить и сумма/состав заказа понятны. Используй этот инструмент только после явного согласия клиента на оплату и подтверждения состава заказа.
update_lead_info — когда клиент назвал имя, телефон, email или класс. Сохраняй все данные в lead.attributes, например grade. Если клиент назвал класс обучения, немедленно сохрани его в attributes.grade, прежде чем отвечать дальше.
add_lead_note — важная деталь для команды.
Не вызывай инструменты без явного повоса в диалоге.
</tools_calling_instructions>`;

  return {
    system_prompt_compiled,
    role: generated.role || '',
    goal: generated.goal || '',
    tone_of_voice: generated.tone_of_voice || '',
    human_communication_style: generated.human_communication_style || '',
    communication_rules: generated.communication_rules || '',
    knowledge_base_principles: generated.knowledge_base_principles || '',
    dialogue_flow: funnelSteps,
    recommended_tools: recommendedTools,
    recommended_handoff_triggers: recommendedHandoffTriggers,
  };
}
