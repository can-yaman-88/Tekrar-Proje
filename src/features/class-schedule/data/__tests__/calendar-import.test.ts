import { looksLikeLab, matchCourse } from '../calendar-import';

const courses = [
  { id: 'c1', name: 'Termodinamik', code: 'ME 204' },
  { id: 'c2', name: 'Statik', code: 'ME 201' },
  { id: 'c3', name: 'Fizik 2', code: null },
];

describe('takvim içe aktarma eşleştirmesi', () => {
  it('önce ders koduna bakar', () => {
    expect(matchCourse('ME 204 Termodinamik I', courses)?.id).toBe('c1');
    expect(matchCourse('ME204 - Ders', courses)?.id).toBe('c1'); // boşluksuz kod
  });

  it('kod yoksa ders adına bakar', () => {
    expect(matchCourse('Fizik 2 dersi', courses)?.id).toBe('c3');
  });

  it('eşleşmeyeni uydurmaz', () => {
    expect(matchCourse('Kariyer Semineri', courses)).toBeNull();
    expect(matchCourse('', courses)).toBeNull();
  });

  it('laboratuvarı başlıktan tanır', () => {
    expect(looksLikeLab('ME 204 Laboratuvar')).toBe(true);
    expect(looksLikeLab('PHYS 102 LAB')).toBe(true);
    expect(looksLikeLab('Fizik 2 uygulama')).toBe(true);
    expect(looksLikeLab('ME 204 Termodinamik')).toBe(false);
  });
});
