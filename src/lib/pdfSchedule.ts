import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type TextItemLike = {
  str: string;
  transform: number[];
};

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

GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Loads a PDF from a public URL. We keep this API small because App/PdfViewer both depend
 * on the same document instance and can share it across extraction + rendering.
 */
export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  const loadingTask = getDocument(url);
  return loadingTask.promise;
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * PDF text comes as many absolutely-positioned tokens. This helper groups tokens that share
 * approximately the same Y coordinate into one human-readable line.
 *
 * Assumption: the schedule document is laid out in table/row-like lines with relatively stable
 * vertical spacing. If that changes, tweak `yBucket` size or sort rules below.
 */
function groupItemsIntoLines(items: TextItemLike[]): string[] {
  const lineMap = new Map<number, TextItemLike[]>();

  for (const item of items) {
    const y = item.transform[5] ?? 0;
    const yBucket = Math.round(y / 2) * 2;

    if (!lineMap.has(yBucket)) {
      lineMap.set(yBucket, []);
    }

    lineMap.get(yBucket)?.push(item);
  }

  return [...lineMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, lineItems]) =>
      lineItems
        .sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))
        .map((item) => item.str)
        .join(' ')
    )
    .map(normalizeLine)
    .filter(Boolean);
}

export async function extractPagesText(pdf: PDFDocumentProxy): Promise<PageText[]> {
  const pages: PageText[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const text = await page.getTextContent();
    const items = text.items.filter((item) => {
      return typeof (item as { str?: unknown }).str === 'string' && Array.isArray((item as { transform?: unknown }).transform);
    }) as TextItemLike[];

    pages.push({
      pageNumber,
      lines: groupItemsIntoLines(items),
      rawItems: items.map((item) => normalizeLine(item.str)).filter(Boolean)
    });
  }

  return pages;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
] as const;

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateTokens(text: string): string[] {
  const result: string[] = [];

  // Matches 2026-02-22 or 2/22/2026 style dates.
  const numericMatches = text.matchAll(/\b(?:(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))\b/g);
  for (const match of numericMatches) {
    if (match[1] && match[2] && match[3]) {
      result.push(toIso(Number(match[1]), Number(match[2]), Number(match[3])));
    } else if (match[4] && match[5] && match[6]) {
      result.push(toIso(Number(match[6]), Number(match[4]), Number(match[5])));
    }
  }

  // Matches month-name formats like "February 22, 2026".
  const namedMatches = text.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi
  );
  for (const match of namedMatches) {
    const month = MONTHS.indexOf(match[1].toLowerCase() as (typeof MONTHS)[number]) + 1;
    result.push(toIso(Number(match[3]), month, Number(match[2])));
  }

  return [...new Set(result)];
}

function inferEntry(line: string): ParsedScheduleEntry {
  // Extremely lightweight extraction that keeps the raw line as ground truth.
  // We only split around common separators to surface likely person/shift tokens.
  const cleaned = normalizeLine(line);
  const segments = cleaned.split(/\s{2,}|\s[-|]\s|\t/).map((segment) => segment.trim()).filter(Boolean);

  if (segments.length >= 2) {
    return {
      person: segments[0],
      shift: segments.slice(1).join(' | '),
      raw: cleaned
    };
  }

  return { raw: cleaned };
}

/**
 * Converts extracted page lines into a normalized schedule object that the calendar can consume.
 *
 * Heuristic notes:
 * - Any line containing a date contributes to that date bucket.
 * - Nearby non-empty lines become entries for that same date until another date line appears.
 * - We retain `raw` text for every entry so future parsing improvements can be built safely.
 * - `dayToPages` keeps page lookup for "jump to date" behavior in the viewer.
 */
export function parseSchedule(pagesText: PageText[]): ParsedSchedule {
  const days: ParsedSchedule['days'] = {};
  const dayToPages: ParsedSchedule['dayToPages'] = {};

  let activeDate: string | null = null;

  for (const page of pagesText) {
    for (const line of page.lines) {
      const dates = parseDateTokens(line);

      if (dates.length > 0) {
        activeDate = dates[0];

        for (const date of dates) {
          if (!days[date]) {
            days[date] = { entries: [] };
          }

          dayToPages[date] = [...new Set([...(dayToPages[date] ?? []), page.pageNumber])];
          days[date].entries.push({ raw: normalizeLine(line) });
        }

        continue;
      }

      if (activeDate && normalizeLine(line)) {
        if (!days[activeDate]) {
          days[activeDate] = { entries: [] };
        }

        days[activeDate].entries.push(inferEntry(line));
      }
    }
  }

  const allDates = Object.keys(days).sort();
  const range = allDates.length ? { start: allDates[0], end: allDates[allDates.length - 1] } : null;

  return { range, days, dayToPages };
}
