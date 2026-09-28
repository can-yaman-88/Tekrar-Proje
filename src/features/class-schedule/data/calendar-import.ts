import type { Weekday } from '@entities/class-session';
import { AppError } from '@shared/lib/errors';
import * as Calendar from 'expo-calendar';

/** A weekly slot recovered from the device calendar, before it is matched to a course. */
export interface CalendarSlot {
  title: string;
  weekday: Weekday;
  startTime: string;
  endTime: string;
  location: string | null;
  /** How many times this slot appeared in the scanned range. */
  occurrences: number;
}

/** Two weeks is enough to see every weekly slot, even with an odd first week. */
const SCAN_DAYS = 14;
const MAX_SLOTS = 60;

const pad = (value: number) => String(value).padStart(2, '0');
const toTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const toWeekday = (date: Date): Weekday => {
  const day = date.getDay(); // 0 = Sunday
  return (day === 0 ? 7 : day) as Weekday;
};

const asDate = (value: Date | string | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Reads the device calendar and collapses events into weekly slots
 * ("Termodinamik, Salı 09:00–10:50"). Nothing is written to the calendar.
 */
export async function readWeeklySlots(): Promise<CalendarSlot[]> {
  const permission = await Calendar.requestCalendarPermissions();
  if (!permission.granted) {
    throw new AppError('unauthorized', 'Takvim izni verilmedi. Telefon ayarlarından açabilirsin.');
  }

  const calendars = await Calendar.getCalendars();
  if (calendars.length === 0) return [];

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + SCAN_DAYS);

  const events = await Calendar.listEvents(calendars, start, end);

  const slots = new Map<string, CalendarSlot>();
  for (const event of events) {
    const startDate = asDate(event.startDate);
    const endDate = asDate(event.endDate);
    const title = event.title?.trim();
    if (!startDate || !endDate || !title || event.allDay) continue;

    const slot: CalendarSlot = {
      title: title.slice(0, 120),
      weekday: toWeekday(startDate),
      startTime: toTime(startDate),
      endTime: toTime(endDate),
      location: event.location?.trim().slice(0, 80) || null,
      occurrences: 1,
    };
    const key = `${slot.title.toLocaleLowerCase('tr')}|${slot.weekday}|${slot.startTime}`;
    const existing = slots.get(key);
    if (existing) existing.occurrences++;
    else slots.set(key, slot);
  }

  return [...slots.values()]
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    .slice(0, MAX_SLOTS);
}

/** Lab hours announce themselves in the event title. */
const LAB_PATTERN = /\b(lab|laboratuvar|laboratuar|uygulama)\b/i;

export const looksLikeLab = (title: string): boolean => LAB_PATTERN.test(title);

const normalise = (value: string): string =>
  value
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Calendars write course codes both ways: "ME 204" and "ME204". */
const compact = (value: string): string => normalise(value).replace(/\s+/g, '');

/**
 * Matches a calendar entry to a course by its code first ("ME 204 Termodinamik"),
 * then by name. Anything unmatched is reported instead of guessed.
 */
export function matchCourse<T extends { id: string; name: string; code: string | null }>(
  slotTitle: string,
  courses: readonly T[],
): T | null {
  const title = normalise(slotTitle);
  if (title === '') return null;

  const compactTitle = compact(slotTitle);
  const byCode = courses.find((course) => course.code && compactTitle.includes(compact(course.code)));
  if (byCode) return byCode;
  return courses.find((course) => title.includes(normalise(course.name))) ?? null;
}
