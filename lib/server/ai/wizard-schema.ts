import { z } from 'zod';

const allowedToolEnum = z.enum([
  'searchKnowledgeBase',
  'redirectToOperator',
  'advanceFunnelStep',
  'getCurrentDate',
  'add_lead_note',
  'update_lead_info',
  'update_lead_status',
  'scheduleMessage',
  'createKaspiInvoice',
]);

const currencyEnum = z.enum(['KZT', 'USD', 'EUR', 'RUB']);
const timezoneEnum = z.enum(['Asia/Almaty', 'Europe/Moscow', 'UTC']);
const writingStyleEnum = z.enum(['Формальный', 'Дружелюбный', 'Нейтральный']);
const addressStyleEnum = z.enum(['Адаптивное', 'На "вы"', 'На "ты"']);
const scenarioEnum = z.enum(['sales', 'consultant', 'support']);
const modelEnum = z.enum(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-flash']);

const funnelStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  triggerDescription: z.string().default(''),
  sampleMessage: z.string().default(''),
  order: z.number().int().min(1),
});

const businessSchema = z.object({
  scenario: scenarioEnum.default('sales'),
  targetAudience: z.string().default(''),
  firstQuestion: z.string().default(''),
  commonObjections: z.array(z.string()).default([]),
});

const funnelSchema = z.object({
  steps: z.array(funnelStepSchema).default([]),
});

const behaviorSchema = z.object({
  handoffTriggers: z.array(z.string()).default([]),
  neverSayPhrases: z.array(z.string()).default([]),
  allowedTools: z.array(allowedToolEnum).default([]),
  responseDelayMs: z.number().int().min(0).max(3000).default(0),
  followUpEnabled: z.boolean().default(true),
});

const channelsSchema = z.object({
  enabled: z.object({
    whatsapp: z.boolean().default(false),
    telegram: z.boolean().default(false),
    instagram: z.boolean().default(false),
    web: z.boolean().default(false),
  }).default({
    whatsapp: false,
    telegram: false,
    instagram: false,
    web: false,
  }),
});

const advancedSchema = z.object({
  model: z.string().default('gemini-2.5-flash'),
  temperature: z.number().min(0).max(1).default(0.4),
  topP: z.number().min(0).max(1).default(0.9),
});

export const wizardPayloadSchema = z.object({
  agentName: z.string().min(1),
  companyName: z.string().min(1),
  companyDescription: z.string().default(''),
  goal: z.string().default(''),
  advantages: z.string().default(''),
  currency: currencyEnum.default('KZT'),
  timezone: timezoneEnum.default('Asia/Almaty'),
  writingStyle: writingStyleEnum.default('Формальный'),
  addressStyle: addressStyleEnum.default('Адаптивное'),
  business: businessSchema.default({
    scenario: 'sales',
    targetAudience: '',
    firstQuestion: '',
    commonObjections: [],
  }),
  funnel: funnelSchema.default({ steps: [] }),
  behavior: behaviorSchema.default({
    handoffTriggers: [],
    neverSayPhrases: [],
    allowedTools: [],
    responseDelayMs: 0,
    followUpEnabled: true,
  }),
  channels: channelsSchema.default({
    enabled: {
      whatsapp: false,
      telegram: false,
      instagram: false,
      web: false,
    },
  }),
  advanced: advancedSchema.default({
    model: 'gemini-2.5-flash',
    temperature: 0.4,
    topP: 0.9,
  }),
}).strict();

export type WizardPayload = z.infer<typeof wizardPayloadSchema>;

export function parseWizardPayload(input: unknown): WizardPayload {
  return wizardPayloadSchema.parse(input);
}
