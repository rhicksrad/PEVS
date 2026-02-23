export type OwnerResolutionArgs<TPerson extends string> = {
  structuredOwner?: TPerson;
  fallbackPerson?: TPerson;
  matchedLegendPerson?: TPerson;
  eventId?: string;
  eventTitle?: string;
  warn?: (message: string, details: Record<string, unknown>) => void;
};

export function resolveInferredOwner<TPerson extends string>({
  structuredOwner,
  fallbackPerson,
  matchedLegendPerson,
  eventId,
  eventTitle,
  warn = console.warn
}: OwnerResolutionArgs<TPerson>): TPerson | undefined {
  if (structuredOwner && fallbackPerson && structuredOwner !== fallbackPerson) {
    warn('Teamup event owner conflict: using structured owner over text inference', {
      id: eventId,
      title: eventTitle,
      structuredOwner,
      fallbackPerson
    });
  }

  if (!structuredOwner && matchedLegendPerson && fallbackPerson && matchedLegendPerson !== fallbackPerson) {
    warn('Teamup event owner conflict: using subcalendar owner over text inference', {
      id: eventId,
      title: eventTitle,
      matchedLegendPerson,
      fallbackPerson
    });
  }

  return structuredOwner ?? matchedLegendPerson ?? fallbackPerson;
}
