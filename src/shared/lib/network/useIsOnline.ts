import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/** Reflects React Query's connectivity view, which NetInfo feeds at startup. */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setIsOnline), []);
  return isOnline;
}
