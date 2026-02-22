export type ParsedScheduleEntry = {
  person?: string;
  shift?: string;
  raw: string;
};

export type ParsedScheduleDay = {
  entries: ParsedScheduleEntry[];
};

export type ParsedSchedule = {
  range: { start: string; end: string } | null;
  days: Record<string, ParsedScheduleDay>;
  dayToPages: Record<string, number[]>;
};

export type PageText = {
  pageNumber: number;
  lines: string[];
  rawItems: string[];
};

export async function loadPdf(_url: string): Promise<null> {
  return null;
}

export async function extractPagesText(_pdf: null): Promise<PageText[]> {
  return [];
}

export function parseSchedule(_pagesText: PageText[]): ParsedSchedule {
  return { range: null, days: {}, dayToPages: {} };
}
