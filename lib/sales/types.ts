export interface NicheTraits {
  decision_type?: string;
  sales_cycle?: string;
  price_sensitivity?: string;
  buying_motivation?: string;
  [key: string]: string | undefined;
}

export interface SalesTechniqueExample {
  niche_slug: string;
  example: string;
}

export const SalesMethodology = {
  SPIN: 'SPIN',
  FAB: 'FAB',
  CHALLENGER: 'Challenger',
} as const;

export type SalesMethodologyValue = (typeof SalesMethodology)[keyof typeof SalesMethodology];

export const DifficultyLevel = {
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
} as const;

export type DifficultyLevelValue = (typeof DifficultyLevel)[keyof typeof DifficultyLevel];

export const SalesOutcome = {
  LEAD_CONVERTED: 'lead_converted',
  APPOINTMENT_SET: 'appointment_set',
  OBJECTION_HANDLED: 'objection_handled',
  FOLLOW_UP_SCHEDULED: 'follow_up_scheduled',
  LOST: 'lost',
} as const;

export type SalesOutcomeValue = (typeof SalesOutcome)[keyof typeof SalesOutcome];

export interface NicheProfile {
  id: string;
  name: string;
  slug: string;
  traits: NicheTraits;
  preferred_methodologies: SalesMethodologyValue[];
  system_prompt_addon: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SalesTechnique {
  id: string;
  methodology: string;
  technique_name: string;
  niche_tags: string[];
  trigger_embedding: string | null;
  trigger_text: string;
  script_template: string;
  examples: SalesTechniqueExample[];
  difficulty: DifficultyLevelValue | null;
  tokens_estimate: number | null;
  is_active: boolean | null;
  created_at: string | null;
}

export interface ConversationExample {
  id: string;
  niche_id: string | null;
  technique_id: string | null;
  situation_embedding: string | null;
  situation_text: string;
  agent_reply: string;
  outcome: SalesOutcomeValue | null;
  channel: string | null;
  created_at: string | null;
}

export interface AgentNicheAssignment {
  id: string;
  agent_id: string;
  niche_id: string | null;
  custom_methodologies: string[];
  custom_prompt_addon: string | null;
  is_active: boolean | null;
  created_at: string | null;
}

export type NicheProfileInsert = Omit<NicheProfile, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SalesTechniqueInsert = Omit<SalesTechnique, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string | null;
};

export type ConversationExampleInsert = Omit<ConversationExample, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string | null;
};

export type AgentNicheAssignmentInsert = Omit<AgentNicheAssignment, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string | null;
};
