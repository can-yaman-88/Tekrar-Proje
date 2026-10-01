import { assertEquals } from 'jsr:@std/assert@1';
import { isTaughtBy, mondayOf, resolveTermStarts, teachingWeekOf, termStartFor } from './term.ts';

Deno.test('ders haftası dönemin başladığı haftanın pazartesisinden sayılır', () => {
  // Dönem 30 Eylül 2026 çarşamba başlıyor: o hafta 1. hafta.
  assertEquals(mondayOf('2026-09-30'), '2026-09-28');
  assertEquals(teachingWeekOf('2026-09-30', '2026-09-28'), 1);
  assertEquals(teachingWeekOf('2026-09-30', '2026-10-04'), 1); // pazar
  assertEquals(teachingWeekOf('2026-09-30', '2026-10-05'), 2);
  assertEquals(teachingWeekOf('2026-09-30', '2026-09-27'), 0); // dönemden önce
});

Deno.test('"bu hafta kaçıncı hafta" cevabından dönem başı bulunur', () => {
  assertEquals(termStartFor('2026-10-21', 4), '2026-09-28');
  assertEquals(teachingWeekOf(termStartFor('2026-10-21', 4), '2026-10-21'), 4);
});

Deno.test('tarihi olmayan ders öbür derslerin ortak başlangıcını alır', () => {
  const starts = resolveTermStarts([
    { id: 'a', termStartDate: '2026-09-28' },
    { id: 'b', termStartDate: null },
    { id: 'c', termStartDate: '2026-09-28' },
    { id: 'd', termStartDate: '2026-10-05' },
  ]);
  assertEquals(starts, { a: '2026-09-28', b: '2026-09-28', c: '2026-09-28', d: '2026-10-05' });
  assertEquals(resolveTermStarts([{ id: 'x', termStartDate: null }]), { x: null });
});

Deno.test('işlenmemiş hafta işlenmiş sayılmaz; takvim yoksa engel de yok', () => {
  assertEquals(isTaughtBy(3, '2026-09-28', '2026-10-11'), false); // 11 Eki pazar: hâlâ 2. hafta
  assertEquals(isTaughtBy(3, '2026-09-28', '2026-10-12'), true); // 3. haftanın pazartesisi
  assertEquals(isTaughtBy(5, '2026-09-28', '2026-10-12'), false);
  assertEquals(isTaughtBy(5, null, '2026-10-12'), true);
  assertEquals(isTaughtBy(null, '2026-09-28', '2026-10-12'), true);
});
