export interface LeadLike {
  id: string;
}

export function getLeadToAutoOpen({
  leadIdFromUrl,
  selectedLeadId,
  leads,
  autoOpenedLeadId,
}: {
  leadIdFromUrl: string | null;
  selectedLeadId: string | null;
  leads: LeadLike[];
  autoOpenedLeadId: string | null;
}): string | null {
  if (!leadIdFromUrl || autoOpenedLeadId === leadIdFromUrl) {
    return null;
  }

  const targetLead = leads.find((lead) => lead.id === leadIdFromUrl);

  if (!targetLead || selectedLeadId === leadIdFromUrl) {
    return null;
  }

  return leadIdFromUrl;
}
