import { mistakeChip, mistakeLabel, normalizeMistake } from '../topic-mistake';

describe('hata defteri maddesi', () => {
  it('yazılanı temizler, boş ya da tek harfi reddeder', () => {
    expect(normalizeMistake('  birim   çevirirken  paydayı ters alıyorum ', ' Birim çevirme ')).toEqual({
      body: 'birim çevirirken paydayı ters alıyorum',
      concept: 'Birim çevirme',
    });
    expect(normalizeMistake(' x ')).toBeNull();
    expect(normalizeMistake('mol hesabı', 'a')).toEqual({ body: 'mol hesabı', concept: null });
    expect(normalizeMistake('a'.repeat(400))?.body.length).toBe(300);
  });

  it('etiket cümlede zaten geçiyorsa ayrıca gösterilmez', () => {
    const inside = { concept: 'Mol', body: 'Mol hesaplarında takıldım' };
    const extra = { concept: 'Birimler', body: 'paydayı ters alıyorum' };
    expect(mistakeChip(inside)).toBeNull();
    expect(mistakeChip(extra)).toBe('Birimler');
    expect(mistakeLabel(extra)).toBe('Birimler — paydayı ters alıyorum');
  });
});
