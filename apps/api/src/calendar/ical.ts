// RFC 5545 helpers for the export feed. Pure functions — easy to unit-test
// in isolation. The CalendarExportService composes these into a full
// VCALENDAR document.

const PRODID = "-//The Owl's Nest//Booking Platform 1.0//EN";
const MAX_LINE_OCTETS = 75;

export interface VEventInput {
  uid: string;
  /** Inclusive — the day the guest arrives / the block starts. */
  dtstart: Date;
  /** Exclusive — first day available again. */
  dtend: Date;
  summary: string;
  description?: string;
  /** When the event was last modified — drives DTSTAMP. */
  dtstamp: Date;
}

/**
 * Format a Date as YYYYMMDD (for VALUE=DATE all-day properties).
 * UTC values to avoid local-timezone surprises in CI / different hosts.
 */
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Format a Date as YYYYMMDDTHHMMSSZ for DTSTAMP (UTC).
 */
export function formatDateTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Escape special characters per RFC 5545 §3.3.11.
 *   \  →  \\
 *   ;  →  \;
 *   ,  →  \,
 *   newline → \n
 */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a single content line to ≤75 octets per line. Continuation lines
 * begin with a single space (per RFC 5545 §3.1).
 *
 * Operates on byte length (UTF-8) since the spec is octet-based, not
 * character-based.
 */
export function foldLine(line: string): string {
  const buf = Buffer.from(line, 'utf-8');
  if (buf.length <= MAX_LINE_OCTETS) return line;

  const parts: string[] = [];
  let cursor = 0;
  let chunkSize = MAX_LINE_OCTETS;
  while (cursor < buf.length) {
    const end = Math.min(cursor + chunkSize, buf.length);
    parts.push(buf.subarray(cursor, end).toString('utf-8'));
    cursor = end;
    chunkSize = MAX_LINE_OCTETS - 1; // continuation lines begin with one space
  }
  return parts.join('\r\n ');
}

/**
 * Build a single VEVENT block. Returns a CRLF-joined block with each line
 * already folded if needed.
 */
export function buildVEvent(input: VEventInput): string {
  const lines: string[] = [
    'BEGIN:VEVENT',
    foldLine(`UID:${input.uid}`),
    `DTSTART;VALUE=DATE:${formatDate(input.dtstart)}`,
    `DTEND;VALUE=DATE:${formatDate(input.dtend)}`,
    `DTSTAMP:${formatDateTime(input.dtstamp)}`,
    foldLine(`SUMMARY:${escapeText(input.summary)}`),
  ];
  if (input.description !== undefined) {
    lines.push(foldLine(`DESCRIPTION:${escapeText(input.description)}`));
  }
  lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  return lines.join('\r\n');
}

/**
 * Wrap a list of pre-built VEVENT strings into a complete VCALENDAR document.
 */
export function buildVCalendar(events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText("The Owl's Nest Availability")}`,
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}
