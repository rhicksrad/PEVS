export type OwnerResolutionArgs<TPerson extends string> = {
  structuredOwner?: TPerson;
  fallbackPerson?: TPerson;
  explicitCalendarPerson?: TPerson;
  idDerivedPerson?: TPerson;
  eventId?: string;
  eventTitle?: string;
  warn?: (message: string, details: Record<string, unknown>) => void;
};

export function resolveInferredOwner<TPerson extends string>({
  structuredOwner,
  fallbackPerson,
  explicitCalendarPerson,
  idDerivedPerson,
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

  const explicitSignalPerson = structuredOwner ?? fallbackPerson ?? explicitCalendarPerson;

  if (!structuredOwner && explicitCalendarPerson && fallbackPerson && explicitCalendarPerson !== fallbackPerson) {
    warn('Teamup event owner conflict: using explicit calendar owner over text inference', {
      id: eventId,
      title: eventTitle,
      explicitCalendarPerson,
      fallbackPerson
    });
  }

  if (idDerivedPerson && explicitSignalPerson && idDerivedPerson !== explicitSignalPerson) {
    warn('Teamup event owner conflict: subcalendar-id mapping disagrees with explicit owner signal', {
      id: eventId,
      title: eventTitle,
      idDerivedPerson,
      explicitSignalPerson
    });
  }

  const resolved = structuredOwner ?? explicitCalendarPerson ?? fallbackPerson ?? idDerivedPerson;

  if (!structuredOwner && !fallbackPerson && !explicitCalendarPerson && idDerivedPerson && resolved === idDerivedPerson) {
    warn('Teamup event owner inferred from subcalendar-id mapping only; verify Teamup subcalendar metadata', {
      id: eventId,
      title: eventTitle,
      idDerivedPerson
    });
  }

  return resolved;
}
