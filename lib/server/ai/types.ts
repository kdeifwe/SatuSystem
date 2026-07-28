import type { WizardPayload } from './wizard-schema';

export type { WizardPayload } from './wizard-schema';
export type BusinessInfo = WizardPayload;
export type AllowedToolName = WizardPayload['behavior']['allowedTools'][number];

export interface GeneratedPrompt {
  system_prompt_compiled: string;
  role: string;
  goal: string;
  tone_of_voice: string;
  human_communication_style: string;
  communication_rules: string;
  knowledge_base_principles: string;
  dialogue_flow: Array<{
    id: string;
    title: string;
    triggerDescription: string;
    sampleMessage: string;
    order: number;
  }>;
  recommended_tools: string[];
  recommended_handoff_triggers: string[];
}
