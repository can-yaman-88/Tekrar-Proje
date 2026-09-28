export interface CourseRef {
  id: string;
  name: string;
  code: string | null;
  colorHex: string | null;
}

export const courseLabel = (course: CourseRef): string => course.code ?? course.name;
