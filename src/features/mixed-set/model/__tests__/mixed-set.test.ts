import { letterOf, scoreHint } from '../mixed-set';

describe('mixed set helpers', () => {
  it('reads the letter the plan gave a step', () => {
    expect(letterOf({ instructions: 'Karışık setin B konusu: 2, 5, 8. sorular.' })).toBe('B');
    expect(letterOf({ instructions: null })).toBeNull();
  });

  it('says what a score does, with the 60 % line in the same place as the database', () => {
    expect(scoreHint(null, 5).text).toBe('Kaç doğru yaptın?');
    expect(scoreHint(2, 5)).toEqual({ text: '%40 · konu yarın yeniden gelir', tone: 'danger' });
    expect(scoreHint(3, 5)).toEqual({ text: '%60 · tekrar takviminde ilerler', tone: 'muted' });
    expect(scoreHint(5, 5)).toEqual({ text: '%100 · tekrar aralığı uzar', tone: 'success' });
  });
});
