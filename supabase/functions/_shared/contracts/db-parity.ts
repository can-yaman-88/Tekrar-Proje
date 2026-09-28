// Compile-time guard: runtime enums must equal the database enums exactly.
import type { Enums } from '../database.types.ts';
import type {
  ExamKind,
  ProcessingStatus,
  TaskSource,
  TaskStatus,
  TaskType,
} from './enums.contract.ts';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;

export type EnumParity = [
  Assert<Equals<TaskStatus, Enums<'task_status'>>>,
  Assert<Equals<TaskType, Enums<'task_type'>>>,
  Assert<Equals<TaskSource, Enums<'task_source'>>>,
  Assert<Equals<ExamKind, Enums<'exam_kind'>>>,
  Assert<Equals<ProcessingStatus, Enums<'processing_status'>>>,
];
