export interface BusinessInfo {
  agentName: string;
  companyName: string;
  companyDescription: string;
  goal: string;
  advantages: string;
  currency: string;
  timezone: string;
  writingStyle: string;
  addressStyle: string;
}

export interface GeneratedPrompt {
  system_prompt_compiled: string;
  role: string;
  goal: string;
  tone_of_voice: string;
  human_communication_style: string;
  communication_rules: string;
  knowledge_base_principles: string;
  dialogue_flow: string;
}
