import type { Tables } from '@shared/api/supabase';
import type { CourseRef } from '../domain/course';

export type CourseRefRow = Pick<Tables<'courses'>, 'id' | 'name' | 'code' | 'color_hex'>;

export const toCourseRef = (row: CourseRefRow): CourseRef => ({
  id: row.id,
  name: row.name,
  code: row.code,
  colorHex: row.color_hex,
});
