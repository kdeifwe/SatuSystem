export type SmartCampaignStatus = 'draft' | 'generating' | 'ready_for_review' | 'sending' | 'done' | 'failed' | 'cancelled';
export type SmartRecipientStatus = 'pending' | 'generated' | 'approved' | 'skipped' | 'sending' | 'sent' | 'failed' | 'replied';

export interface AudienceFilter {
  signal_types?: string[];
  tags?: string[];
  statuses?: string[];
  min_signal_age_hours?: number;
  /** Internal campaign routing field; smart_campaigns has no agent_id column. */
  agent_id?: string;
}

export interface SmartCampaign {
  id: string;
  org_id: string;
  name: string;
  goal_instruction: string;
  audience_filter: AudienceFilter;
  requires_approval: boolean;
  send_pacing_per_minute: number;
  respect_work_hours: boolean;
  max_message_length: number;
  status: SmartCampaignStatus;
  created_by?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface SmartRecipient {
  id: string;
  campaign_id: string;
  lead_id: string;
  signal_id: string;
  generated_message?: string | null;
  edited_message?: string | null;
  status: SmartRecipientStatus;
  skip_reason?: string | null;
  ai_call_log_id?: string | null;
  sent_at?: string | null;
  replied_at?: string | null;
}

export interface SmartDeliveryAdapter {
  send: (args: { lead: Record<string, any>; channel: Record<string, any>; text: string }) => Promise<void>;
}
