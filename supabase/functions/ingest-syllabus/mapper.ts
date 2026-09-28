// Deterministic normalisation of the LLM's syllabus reading into database rows.
// Everything the model gets wrong (bad dates, duplicate topics, silly weights)
// is dropped here with a warning rather than reaching the database.
import type { SyllabusExtraction } from '../_shared/contracts/syllabus.contract.ts';
import type { ExamKind, IsoDate } from '../_shared/contracts/enums.contract.ts';
import { addDays, diffInDays } from '../_shared/domain/dates.ts';

export type TopicRow = { title: string; week_number: number | null; position: number };
export type ExamRow = {
  kind: ExamKind;
  title: string;
  exam_date: IsoDate;
  start_time: null;
  weight_percent: number | null;
  topic_weeks: number[];
};
export type SyllabusPayload = {
  course: { name: string; code: string | null; color_hex: null; term_start_date: IsoDate | null };
  topics: TopicRow[];
  exams: ExamRow[];
};

export interface MappedSyllabus {
  payload: SyllabusPayload | null;
  warnings: string[];
}

const MAX_TOPICS = 100;
const MAX_EXAMS = 25;
const MAX_WEEK = 30;
/** An exam date this far from today is a misread year, not a real exam. */
const MAX_PAST_DAYS = 400;
const MAX_FUTURE_DAYS = 800;
/** Titles that mean "laboratory", whatever kind the model assigned to them. */
const LAB_TITLE = /\b(lab|labs|laboratory|laboratuvar|laboratuar)\b/i;

const trim = (value: string | null, max: number): string | null => {
  const text = value?.trim().replace(/\s+/g, ' ') ?? '';
  return text === '' ? null : text.slice(0, max);
};

const validWeek = (week: number | null): number | null =>
  week === null || !Number.isFinite(week) || week < 1 || week > MAX_WEEK ? null : Math.trunc(week);

const isIsoDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Syllabi often date exams by week ("Midterm: 8. hafta"). With week 1's date
 * known, such an exam lands on the Sunday of that week — the end of the week it
 * belongs to, so nothing is scheduled past it.
 */
function sundayOfWeek(termStart: IsoDate, week: number): IsoDate {
  const weekMonday = addDays(termStart, (week - 1) * 7);
  const weekday = new Date(`${weekMonday}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const daysToSunday = weekday === 0 ? 0 : 7 - weekday;
  return addDays(weekMonday, daysToSunday);
}

export function mapSyllabus(extraction: SyllabusExtraction, today: IsoDate): MappedSyllabus {
  const warnings: string[] = [];

  const courseName = trim(extraction.course.name, 120);
  if (!courseName) return { payload: null, warnings: ['Ders adı okunamadı.'] };

  const statedTermStart = extraction.course.termStartDate?.trim() ?? '';
  const termStart = isIsoDate(statedTermStart) ? statedTermStart : null;

  // --- topics: de-duplicated, ordered, positioned within their week
  const seenTitles = new Set<string>();
  const positionByWeek = new Map<number | null, number>();
  const topics: TopicRow[] = [];
  let droppedTopics = 0;

  for (const topic of extraction.topics) {
    if (topics.length >= MAX_TOPICS) break;
    const title = trim(topic.title, 200);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seenTitles.has(key)) {
      droppedTopics++;
      continue;
    }
    seenTitles.add(key);
    const week = validWeek(topic.weekNumber);
    const position = positionByWeek.get(week) ?? 0;
    positionByWeek.set(week, position + 1);
    topics.push({ title, week_number: week, position });
  }
  if (droppedTopics > 0) warnings.push(`${droppedTopics} tekrar eden konu atlandı.`);

  // --- exams: a usable date is mandatory, everything else is optional
  const exams: ExamRow[] = [];
  const seenExams = new Set<string>();

  for (const exam of extraction.exams) {
    if (exams.length >= MAX_EXAMS) break;
    // Labs are the student's own business: never imported, never warned about.
    if (exam.kind === 'lab' || LAB_TITLE.test(exam.title)) continue;
    const title = trim(exam.title, 120) ?? exam.kind;
    const stated = exam.date?.trim() ?? '';
    const week = validWeek(exam.weekNumber);

    // A real date wins; otherwise a week number plus the term start gives one.
    let date = isIsoDate(stated) ? stated : '';
    if (!date && week !== null && termStart !== null) {
      date = sundayOfWeek(termStart, week);
      warnings.push(`"${title}" tarihi yazmıyordu; ${week}. haftanın pazarına (${date}) konuldu.`);
    }
    if (!date) {
      warnings.push(
        week === null
          ? `"${title}" için tarih okunamadı, sınav eklenmedi.`
          : `"${title}" yalnızca hafta numarasıyla verilmiş ama dönem başlangıcı bilinmiyor, sınav eklenmedi.`,
      );
      continue;
    }
    const offset = diffInDays(today, date);
    if (offset < -MAX_PAST_DAYS || offset > MAX_FUTURE_DAYS) {
      warnings.push(`"${title}" tarihi (${date}) mantıklı görünmedi, sınav eklenmedi.`);
      continue;
    }
    const key = `${title.toLowerCase()}|${date}`;
    if (seenExams.has(key)) continue;
    seenExams.add(key);

    const weight = exam.weightPercent;
    exams.push({
      kind: exam.kind,
      title,
      exam_date: date,
      start_time: null,
      weight_percent: weight !== null && Number.isFinite(weight) && weight > 0 && weight <= 100 ? weight : null,
      topic_weeks: [...new Set(exam.coversWeeks.map(validWeek).filter((w): w is number => w !== null))],
    });
  }

  if (topics.length === 0) warnings.push('Haftalık konu listesi bulunamadı.');
  if (exams.length === 0) {
    warnings.push('Sınav tarihi bulunamadı. Ders sayfasından elle ekleyebilirsin.');
  }

  return {
    payload: {
      course: {
        name: courseName,
        code: trim(extraction.course.code, 20),
        color_hex: null,
        term_start_date: termStart,
      },
      topics,
      exams,
    },
    warnings,
  };
}
