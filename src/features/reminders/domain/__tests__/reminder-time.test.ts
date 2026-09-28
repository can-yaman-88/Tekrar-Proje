import { learnReminderHours, toNotificationWeekday, toStudyMoment, type StudyMoment } from '../reminder-time';

const moment = (weekday: number, hour: number): StudyMoment => ({ weekday, hour });

describe('learnReminderHours', () => {
  it('geçmiş yoksa seçilen saati korur', () => {
    const learned = learnReminderHours([], 20);
    expect(learned.learnedWeekdays).toEqual([]);
    expect(learned.hourByWeekday[1]).toBe(20);
  });

  it('bir günün kendi ritmini öğrenir, bitişten bir saat sonrasına koyar', () => {
    const learned = learnReminderHours([moment(2, 19), moment(2, 20), moment(2, 19)], 20);
    expect(learned.learnedWeekdays).toEqual([2]);
    expect(learned.hourByWeekday[2]).toBe(20);
  });

  it('tek gözlemli günü öğrenilmiş saymaz ama genel ritmi ödünç verir', () => {
    const learned = learnReminderHours([moment(2, 21), moment(3, 21), moment(5, 21)], 18);
    expect(learned.learnedWeekdays).toEqual([]);
    expect(learned.hourByWeekday[1]).toBe(22); // genel medyan + 1
  });

  it('uç saatleri makul aralığa sıkıştırır', () => {
    const late = learnReminderHours([moment(6, 3), moment(6, 2)], 20);
    expect(late.hourByWeekday[6]).toBe(17);

    const early = learnReminderHours([moment(6, 23), moment(6, 23)], 20);
    expect(early.hourByWeekday[6]).toBe(23);
  });

  it('tek bir aykırı geceye teslim olmaz', () => {
    const learned = learnReminderHours([moment(4, 19), moment(4, 19), moment(4, 19), moment(4, 3)], 20);
    expect(learned.hourByWeekday[4]).toBe(20);
  });
});

describe('toNotificationWeekday', () => {
  it('ISO gününü platformun pazar=1 düzenine çevirir', () => {
    expect(toNotificationWeekday(1)).toBe(2); // Pazartesi
    expect(toNotificationWeekday(6)).toBe(7); // Cumartesi
    expect(toNotificationWeekday(7)).toBe(1); // Pazar
  });
});

describe('toStudyMoment', () => {
  it('oturumun bitiş anını yerel saate göre verir', () => {
    const started = new Date(2026, 8, 22, 18, 30); // Salı 18:30 yerel
    const moment = toStudyMoment(started.toISOString(), 45);
    expect(moment).toEqual({ weekday: 2, hour: 19 });
  });

  it('gece yarısını aşan oturum ertesi güne yazılır', () => {
    const started = new Date(2026, 8, 22, 23, 30); // Salı 23:30
    expect(toStudyMoment(started.toISOString(), 60)).toEqual({ weekday: 3, hour: 0 });
  });
});
