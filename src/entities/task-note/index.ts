export { taskNoteRepository } from './data/task-note.repository';
export type { TaskNote } from './domain/task-note';
export {
  taskNoteKeys,
  taskNoteMutationKeys,
  useAddTaskNote,
  useDeleteTaskNote,
  useTaskNotes,
} from './model/task-note.queries';
export { NoteItem, type NoteItemProps } from './ui/NoteItem';
