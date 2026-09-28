import type { IsoDate } from '@contracts/enums.contract';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { todayLocal } from './localDate';

/** Local date that rolls over when the app returns to the foreground on a new day. */
export function useToday(): IsoDate {
  const [today, setToday] = useState(todayLocal);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(todayLocal());
    });
    return () => sub.remove();
  }, []);

  return today;
}
