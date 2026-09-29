/** Something the student got wrong, kept until they say they have it. */
export interface TopicMistake {
  id: string;
  topicId: string;
  /** What went wrong, in the student's own words — the part worth reading. */
  body: string;
  /** Short label for grouping ("Mol hesapları"); may repeat across entries. */
  concept: string | null;
  taskId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const isOpenMistake = (mistake: TopicMistake): boolean => mistake.resolvedAt === null;

/** A book entry with the names needed to file it under a course and topic. */
export interface TopicMistakeWithContext extends TopicMistake {
  topicTitle: string;
  /** Where the topic sits in the syllabus, so lists follow the course's own order. */
  topicWeek: number | null;
  topicPosition: number;
  courseLabel: string;
}

/**
 * How an entry reads in a list. The label is only worth showing when it adds
 * something the sentence does not already say.
 */
export function mistakeLabel(mistake: TopicMistake): string {
  const { concept, body } = mistake;
  if (concept === null) return body;
  return body.toLocaleLowerCase('tr').includes(concept.toLocaleLowerCase('tr')) ? body : `${concept} — ${body}`;
}
