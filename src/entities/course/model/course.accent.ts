import { accentPalette } from '@shared/ui/theme';
import type { CourseRef } from '../domain/course';

/** Stable accent colour: explicit course colour, else hashed from the id. */
export function courseAccent(course: CourseRef): string {
  if (course.colorHex) return course.colorHex;
  let hash = 0;
  for (let i = 0; i < course.id.length; i++) hash = (hash * 31 + course.id.charCodeAt(i)) | 0;
  return accentPalette[Math.abs(hash) % accentPalette.length] ?? accentPalette[0];
}
