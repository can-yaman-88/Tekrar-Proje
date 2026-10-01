export { courseRepository, type CourseTerm, type CourseWithStats } from './data/course.repository';
export { toCourseRef, type CourseRefRow } from './data/course.mapper';
export { courseLabel, type CourseRef } from './domain/course';
export { courseAccent } from './model/course.accent';
export {
  courseKeys,
  courseMutationKeys,
  useCourse,
  useCourses,
  useCourseTerms,
  useDeleteCourse,
  useSetTermStart,
} from './model/course.queries';
