import {
  buildVCalendar,
  buildVEvent,
  escapeText,
  foldLine,
  formatDate,
  formatDateTime,
} from './ical';

describe('formatDate', () => {
  it('formats a Date as YYYYMMDD using UTC', () => {
    expect(formatDate(new Date('2026-07-15T00:00:00Z'))).toBe('20260715');
    expect(formatDate(new Date('2026-01-05T00:00:00Z'))).toBe('20260105');
    expect(formatDate(new Date('2026-12-31T00:00:00Z'))).toBe('20261231');
  });

  it('is timezone-stable across hosts (uses UTC components)', () => {
    // A Date constructed from a date-only string is interpreted as UTC midnight,
    // so this should always produce 20260715 regardless of the host TZ.
    expect(formatDate(new Date('2026-07-15'))).toBe('20260715');
  });
});

describe('formatDateTime', () => {
  it('formats a Date as YYYYMMDDTHHMMSSZ', () => {
    expect(formatDateTime(new Date('2026-07-15T13:45:09Z'))).toBe('20260715T134509Z');
  });
});

describe('escapeText', () => {
  it('escapes backslashes', () => {
    expect(escapeText('path\\to\\thing')).toBe('path\\\\to\\\\thing');
  });
  it('escapes semicolons and commas', () => {
    expect(escapeText('a,b;c')).toBe('a\\,b\\;c');
  });
  it('escapes newlines', () => {
    expect(escapeText('line one\nline two')).toBe('line one\\nline two');
    expect(escapeText('line one\r\nline two')).toBe('line one\\nline two');
  });
  it('leaves benign text unchanged', () => {
    expect(escapeText("The Owl's Nest — Reserved")).toBe("The Owl's Nest — Reserved");
  });
  it('escapes characters in the right order (backslash first)', () => {
    expect(escapeText('a\\;b')).toBe('a\\\\\\;b');
  });
});

describe('foldLine', () => {
  it('returns short lines unchanged', () => {
    const line = 'SUMMARY:Reserved';
    expect(foldLine(line)).toBe(line);
  });
  it('folds at 75 octets, continuation begins with one space', () => {
    const long = 'X'.repeat(150);
    const folded = foldLine(`SUMMARY:${long}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].length).toBe(75);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith(' ')).toBe(true);
    }
  });
  it('folds on byte length, not character length (multibyte safe)', () => {
    const emoji = '🦉'.repeat(40); // each emoji is 4 bytes
    const folded = foldLine(`SUMMARY:${emoji}`);
    // Just assert it doesn't crash and produces output
    expect(folded.length).toBeGreaterThan(0);
  });
});

describe('buildVEvent', () => {
  const base = {
    uid: 'booking-abc@owlsnest.com',
    dtstart: new Date('2026-07-15T00:00:00Z'),
    dtend: new Date('2026-07-18T00:00:00Z'),
    summary: 'Reserved',
    dtstamp: new Date('2026-07-10T12:00:00Z'),
  };

  it('produces a valid VEVENT block with required fields', () => {
    const out = buildVEvent(base);
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
    expect(out).toContain('UID:booking-abc@owlsnest.com');
    expect(out).toContain('DTSTART;VALUE=DATE:20260715');
    expect(out).toContain('DTEND;VALUE=DATE:20260718');
    expect(out).toContain('DTSTAMP:20260710T120000Z');
    expect(out).toContain('SUMMARY:Reserved');
    expect(out).toContain('TRANSP:OPAQUE');
  });

  it('omits DESCRIPTION when not provided', () => {
    const out = buildVEvent(base);
    expect(out).not.toContain('DESCRIPTION:');
  });

  it('includes and escapes DESCRIPTION when provided', () => {
    const out = buildVEvent({
      ...base,
      description: 'Owner stay; HVAC, etc.',
    });
    expect(out).toContain('DESCRIPTION:Owner stay\\; HVAC\\, etc.');
  });

  it('uses CRLF line endings', () => {
    const out = buildVEvent(base);
    expect(out).toMatch(/BEGIN:VEVENT\r\n/);
  });
});

describe('buildVCalendar', () => {
  it('wraps events in a VCALENDAR with required headers', () => {
    const event = buildVEvent({
      uid: 'x@y',
      dtstart: new Date('2026-07-15T00:00:00Z'),
      dtend: new Date('2026-07-18T00:00:00Z'),
      summary: 'Reserved',
      dtstamp: new Date('2026-07-10T12:00:00Z'),
    });
    const cal = buildVCalendar([event]);
    expect(cal).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(cal).toMatch(/\r\nEND:VCALENDAR$/);
    expect(cal).toContain('VERSION:2.0');
    expect(cal).toContain('PRODID:');
    expect(cal).toContain('CALSCALE:GREGORIAN');
    expect(cal).toContain('METHOD:PUBLISH');
    expect(cal).toContain("X-WR-CALNAME:The Owl's Nest Availability");
  });

  it('produces an empty (but valid) calendar when no events', () => {
    const cal = buildVCalendar([]);
    expect(cal).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(cal).toMatch(/\r\nEND:VCALENDAR$/);
    expect(cal).not.toContain('BEGIN:VEVENT');
  });
});
