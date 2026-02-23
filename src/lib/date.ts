export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function startOfMonth(monthDate: Date): Date {
  return new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
}

export function endOfMonth(monthDate: Date): Date {
  return new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
}

export function getCalendarGridDays(monthDate: Date): Date[] {
  const firstDay = startOfMonth(monthDate);
  const lastDay = endOfMonth(monthDate);
  const startOffset = firstDay.getDay();
  const endOffset = 6 - lastDay.getDay();
  const gridStart = new Date(firstDay);
  const gridEnd = new Date(lastDay);
  gridStart.setDate(firstDay.getDate() - startOffset);
  gridEnd.setDate(lastDay.getDate() + endOffset);

  const totalDays = Math.floor((gridEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  return Array.from({ length: totalDays }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

export function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}
