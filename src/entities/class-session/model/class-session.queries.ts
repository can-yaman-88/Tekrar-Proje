import { useQuery } from '@tanstack/react-query';
import { classSessionRepository } from '../data/class-session.repository';

export const classSessionKeys = {
  all: ['class-sessions'] as const,
  list: () => [...classSessionKeys.all, 'list'] as const,
};

export function useClassSchedule() {
  return useQuery({
    queryKey: classSessionKeys.list(),
    queryFn: () => classSessionRepository.list(),
    // The timetable only changes when the student edits it.
    staleTime: 60 * 60_000,
  });
}
