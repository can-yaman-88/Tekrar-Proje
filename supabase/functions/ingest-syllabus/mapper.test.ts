import { assertEquals } from 'jsr:@std/assert@1';
import type { SyllabusExtraction } from '../_shared/contracts/syllabus.contract.ts';
import { mapSyllabus } from './mapper.ts';

const TODAY = '2026-09-22';

const extraction = (over: Partial<SyllabusExtraction>): SyllabusExtraction => ({
  course: { name: 'Thermodynamics', code: 'ME 204', termStartDate: null },
  topics: [],
  exams: [],
  ...over,
});

Deno.test('normalises topics: trims, de-duplicates, positions within a week', () => {
  const { payload, warnings } = mapSyllabus(
    extraction({
      topics: [
        { title: '  First   law  ', weekNumber: 4 },
        { title: 'FIRST LAW', weekNumber: 4 },
        { title: 'Entropy', weekNumber: 4 },
        { title: 'Carnot cycle', weekNumber: 99 },
      ],
    }),
    TODAY,
  );
  assertEquals(payload?.topics, [
    { title: 'First law', week_number: 4, position: 0 },
    { title: 'Entropy', week_number: 4, position: 1 },
    { title: 'Carnot cycle', week_number: null, position: 0 },
  ]);
  assertEquals(warnings.includes('1 tekrar eden konu atlandı.'), true);
});

Deno.test('drops exams with unusable or implausible dates', () => {
  const { payload, warnings } = mapSyllabus(
    extraction({
      exams: [
        { kind: 'midterm', title: 'Midterm 1', date: '2026-11-04', weekNumber: null, weightPercent: 30, coversWeeks: [1, 2, 99] },
        { kind: 'final', title: 'Final', date: 'TBA', weekNumber: null, weightPercent: 40, coversWeeks: [] },
        { kind: 'quiz', title: 'Quiz 1', date: '2019-03-01', weekNumber: null, weightPercent: 5, coversWeeks: [] },
        { kind: 'quiz', title: 'Quiz 2', date: '2026-10-01', weekNumber: null, weightPercent: 500, coversWeeks: [] },
      ],
    }),
    TODAY,
  );
  assertEquals(payload?.exams.map((e) => e.title), ['Midterm 1', 'Quiz 2']);
  assertEquals(payload?.exams[0]?.topic_weeks, [1, 2]);
  assertEquals(payload?.exams[1]?.weight_percent, null); // 500% is not a weight
  assertEquals(warnings.length >= 2, true);
});

Deno.test('a missing course name fails the ingestion', () => {
  const { payload, warnings } = mapSyllabus(
    extraction({ course: { name: '   ', code: null, termStartDate: null } }),
    TODAY,
  );
  assertEquals(payload, null);
  assertEquals(warnings, ['Ders adı okunamadı.']);
});

Deno.test('hafta numarasıyla verilen sınav o haftanın pazarına konur', () => {
  const { payload, warnings } = mapSyllabus(
    extraction({
      // 1. hafta 28 Eylül 2026 pazartesi; 8. hafta 16 Kasım pazartesi, pazarı 22 Kasım.
      course: { name: 'Termodinamik', code: 'ME 204', termStartDate: '2026-09-28' },
      exams: [
        { kind: 'midterm', title: 'Vize 1', date: null, weekNumber: 8, weightPercent: 30, coversWeeks: [] },
      ],
    }),
    TODAY,
  );
  assertEquals(payload?.exams[0]?.exam_date, '2026-11-22');
  assertEquals(payload?.course.term_start_date, '2026-09-28');
  assertEquals(warnings.some((w) => w.includes('8. haftanın pazarına')), true);
});

Deno.test('dönem başlangıcı bilinmeden hafta numarası tarih üretmez', () => {
  const { payload, warnings } = mapSyllabus(
    extraction({
      exams: [{ kind: 'final', title: 'Final', date: null, weekNumber: 14, weightPercent: 40, coversWeeks: [] }],
    }),
    TODAY,
  );
  assertEquals(payload?.exams, []);
  assertEquals(warnings.some((w) => w.includes('dönem başlangıcı bilinmiyor')), true);
});

Deno.test('laboratuvar satırları hiç içeri alınmaz ve uyarı üretmez', () => {
  const { payload, warnings } = mapSyllabus(
    extraction({
      exams: [
        { kind: 'lab', title: 'Laboratory Experiments', date: null, weekNumber: null, weightPercent: 10, coversWeeks: [] },
        { kind: 'other', title: 'Lab Reports', date: null, weekNumber: null, weightPercent: 5, coversWeeks: [] },
        { kind: 'midterm', title: 'Vize 1', date: '2026-11-04', weekNumber: null, weightPercent: 30, coversWeeks: [] },
      ],
    }),
    TODAY,
  );
  assertEquals(payload?.exams.map((e) => e.title), ['Vize 1']);
  assertEquals(warnings.some((w) => w.toLowerCase().includes('lab')), false);
});

Deno.test('hiç sınav tarihi çıkmazsa elle girme önerilir', () => {
  const { warnings } = mapSyllabus(
    extraction({
      exams: [{ kind: 'final', title: 'Final', date: null, weekNumber: null, weightPercent: 40, coversWeeks: [] }],
    }),
    TODAY,
  );
  assertEquals(warnings.some((w) => w.includes('elle ekleyebilirsin')), true);
});
