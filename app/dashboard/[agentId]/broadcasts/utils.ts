export interface AudienceSignalItem {
  id: string;
  lead_id: string;
  signal_type: string;
  description: string;
  raw_quote?: string | null;
  status: string;
  created_at: string;
}

export interface SmartSignalListItem extends AudienceSignalItem {
  lead_name?: string | null;
  lead_status?: string | null;
}

export interface SmartSignalTableFilter {
  signalType: string;
  dateRange: string;
  leadStatus: string;
}

const DEFAULT_SIGNAL_TYPES = [
  'awaiting_funds',
  'awaiting_approval',
  'awaiting_decision',
  'competitor_comparison',
  'busy_later',
  'price_objection',
  'custom',
] as const;

export function filterSignalsForAudience(
  signals: AudienceSignalItem[],
  selectedSignalTypes: string[],
  minSignalAgeHours: number,
  now: Date = new Date(),
): AudienceSignalItem[] {
  const activeSignalTypes = selectedSignalTypes.length > 0 ? selectedSignalTypes : [...DEFAULT_SIGNAL_TYPES];

  return signals.filter((signal) => {
    if (signal.status !== 'active') {
      return false;
    }

    if (!activeSignalTypes.includes(signal.signal_type)) {
      return false;
    }

    if (minSignalAgeHours <= 0) {
      return true;
    }

    const createdAt = new Date(signal.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      return false;
    }

    const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    return ageHours >= minSignalAgeHours;
  });
}

export function getAudienceLeadCount(
  signals: AudienceSignalItem[],
  selectedSignalTypes: string[],
  minSignalAgeHours: number,
  now: Date = new Date(),
): number {
  return new Set(
    filterSignalsForAudience(signals, selectedSignalTypes, minSignalAgeHours, now).map((signal) => signal.lead_id),
  ).size;
}

export function getActiveSignalsCount(signals: Array<{ status?: string | null }>): number {
  return signals.filter((signal) => signal.status === 'active').length;
}

export function filterSignalsForTable(
  signals: SmartSignalListItem[],
  filters: SmartSignalTableFilter,
  now: Date = new Date(),
): SmartSignalListItem[] {
  const normalizedSignalType = filters.signalType?.trim().toLowerCase();
  const normalizedLeadStatus = filters.leadStatus?.trim().toLowerCase();

  return signals.filter((signal) => {
    if (normalizedSignalType && normalizedSignalType !== 'all' && signal.signal_type !== normalizedSignalType) {
      return false;
    }

    if (normalizedLeadStatus && normalizedLeadStatus !== 'all') {
      const leadStatus = (signal.lead_status ?? '').trim().toLowerCase();
      if (leadStatus !== normalizedLeadStatus) {
        return false;
      }
    }

    if (filters.dateRange && filters.dateRange !== 'all') {
      const createdAt = new Date(signal.created_at);
      if (Number.isNaN(createdAt.getTime())) {
        return false;
      }

      const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      const rangeHours = filters.dateRange === '24h' ? 24 : filters.dateRange === '7d' ? 24 * 7 : 24 * 30;
      if (ageHours > rangeHours) {
        return false;
      }
    }

    return true;
  });
}

export function buildCampaignTimeline(
  recipients: Array<{ status: string; sent_at?: string | null; replied_at?: string | null; created_at?: string | null }>,
  now: Date = new Date(),
) {
  const buckets = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (4 - index)));
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      date: key,
      sent: 0,
      replied: 0,
      failed: 0,
      skipped: 0,
    };
  });

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const recipient of recipients) {
    const candidateDate = recipient.status === 'replied' && recipient.replied_at
      ? recipient.replied_at
      : recipient.sent_at ?? recipient.created_at;
    const parsedDate = new Date(candidateDate ?? now);
    if (Number.isNaN(parsedDate.getTime())) {
      continue;
    }

    const key = parsedDate.toISOString().slice(0, 10);
    const bucket = bucketMap.get(key);
    if (!bucket) {
      continue;
    }

    if (recipient.status === 'failed') {
      bucket.failed += 1;
    } else if (recipient.status === 'skipped') {
      bucket.skipped += 1;
    } else if (recipient.status === 'replied') {
      bucket.replied += 1;
    } else if (recipient.status === 'sent') {
      bucket.sent += 1;
    }
  }

  return buckets;
}

export function pickPreviewSignals(
  signals: AudienceSignalItem[],
  selectedSignalTypes: string[],
  minSignalAgeHours: number,
  limit = 3,
  now: Date = new Date(),
  random: () => number = Math.random,
): AudienceSignalItem[] {
  const filtered = filterSignalsForAudience(signals, selectedSignalTypes, minSignalAgeHours, now);
  if (filtered.length === 0) {
    return [];
  }

  const shuffled = [...filtered];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }

  return shuffled.slice(0, Math.min(limit, shuffled.length));
}
