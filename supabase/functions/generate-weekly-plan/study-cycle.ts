// The student's study loop, as data.
//
//   1. concept_note       konu işlendikten sonra ünitenin konsept sayfasına ekle
//   2. feynman            boş kâğıda, sıfırdan anlatır gibi yaz
//   3. quiz               10 soruluk otomasyon sınavı (hocanın materyali varsa o öncelikli)
//   4. advanced_problems  yalnızca öğrenci elinde zor soru olduğunu söylediyse
//
// Adım 1 ve 2 aynı gün, arka arkaya yapılır — öğrencinin fiilen çalıştığı biçim
// bu. Sınav Feynman sayfasından önce olmaz: aynı gün ya da sonraki bir gün.
// (Eskiden her zaman ertesi güne itiliyordu; öğrenci sınavı çoğu zaman sayfanın
// hemen ardından çözüyor, ve kural haftayı gereksiz yere dolduruyordu.)
//
// Tekrar (spaced repetition) aynı mantıkla ama kısa hâliyle yürür:
// önce Feynman sayfası, sonra sıradaki sınav.
import type { StudyStep, TaskType } from '../_shared/contracts/enums.contract.ts';

export const FIRST_CYCLE: readonly StudyStep[] = ['concept_note', 'feynman', 'quiz', 'advanced_problems'];
export const REVIEW_CYCLE: readonly StudyStep[] = ['feynman', 'quiz'];

/** Steps the student does back to back, so they belong on the same day. */
export const SAME_DAY_PAIR: readonly StudyStep[] = ['concept_note', 'feynman'];

/** Steps that may share the pair's day but never come before it. */
export const SAME_DAY_OR_LATER_STEPS: readonly StudyStep[] = ['quiz'];

/** A step never gets scheduled before the ones before it are done. */
export const stepOrder = (step: StudyStep): number => FIRST_CYCLE.indexOf(step);

export interface StepEffort {
  minutes: number;
  targetCount: number | null;
}

const FIRST_CYCLE_EFFORT: Record<StudyStep, StepEffort> = {
  concept_note: { minutes: 30, targetCount: null },
  quiz: { minutes: 25, targetCount: 10 },
  feynman: { minutes: 25, targetCount: null },
  advanced_problems: { minutes: 45, targetCount: 5 },
};

const REVIEW_EFFORT: Record<StudyStep, StepEffort> = {
  concept_note: { minutes: 20, targetCount: null },
  quiz: { minutes: 20, targetCount: 10 },
  feynman: { minutes: 20, targetCount: null },
  advanced_problems: { minutes: 40, targetCount: 5 },
};

export const effortOf = (step: StudyStep, isReview: boolean): StepEffort =>
  isReview ? REVIEW_EFFORT[step] : FIRST_CYCLE_EFFORT[step];

/** Study steps are task types one-to-one, so nothing is lost in translation. */
export const taskTypeOf = (step: StudyStep): TaskType => step;

export function stepCopy(
  step: StudyStep,
  topicTitle: string,
  options: { isReview: boolean; useTeacherMaterial: boolean },
): { title: string; instructions: string } {
  if (options.isReview) {
    switch (step) {
      case 'feynman':
        return {
          title: `Tekrar: ${topicTitle} — Feynman sayfası`,
          instructions: 'Boş kâğıda, konuyu ilk kez duyan birine anlatır gibi yaz; tıkandığın yeri işaretle.',
        };
      case 'quiz':
        return {
          title: `Tekrar: ${topicTitle} — sıradaki sınav`,
          instructions: 'Otomasyondan gelen yeni sınavı çöz; yanlışlarını Feynman sayfandaki boşluklarla eşleştir.',
        };
      default:
        break;
    }
  }

  switch (step) {
    case 'concept_note':
      return {
        title: `${topicTitle} — konsept sayfasına ekle`,
        instructions:
          'Konuyu ünitenin konsept sayfasına ekle: tanımlar, bağlantı okları, nereye bağlandığı ve bir örnek.',
      };
    case 'quiz':
      return options.useTeacherMaterial
        ? {
            title: `${topicTitle} — hocanın sorularını çöz`,
            instructions: 'Hocanın yüklediği soruları/ödevi bitir; otomasyon sınavına bundan sonra geç.',
          }
        : {
            title: `${topicTitle} — 10 soruluk sınavı çöz`,
            instructions: 'Otomasyonla ürettiğin 10 soruluk sınavı çöz; her yanlışta eksik kavramı not al.',
          };
    case 'feynman':
      return {
        title: `${topicTitle} — Feynman sayfası yaz`,
        instructions: 'Boş kâğıda sıfırdan anlat; anlatamadığın adım, dönüp çalışman gereken yerdir.',
      };
    case 'advanced_problems':
      return {
        title: `${topicTitle} — ileri seviye problemler`,
        instructions: 'Elindeki zor sorulardan çöz; çözemediklerini Feynman sayfandaki boşluklarla eşleştir.',
      };
  }
}
