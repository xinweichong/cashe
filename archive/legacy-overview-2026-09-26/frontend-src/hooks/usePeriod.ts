import { useState, useCallback } from 'react';
import { toDateStr } from '@/lib/utils';

export type Period = 'day' | 'week' | 'month';

export function usePeriod() {
  const [period, setPeriod] = useState<Period>('month');
  const [date, setDate] = useState(() => toDateStr(new Date()));

  const goBack = useCallback(() => {
    const [y, mo, dy] = date.split('-').map(Number);
    const d = new Date(y, mo - 1, dy); // local time, not UTC
    if (period === 'day') d.setDate(d.getDate() - 1);
    else if (period === 'week') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setDate(toDateStr(d));
  }, [date, period]);

  const goForward = useCallback(() => {
    const [y, mo, dy] = date.split('-').map(Number);
    const d = new Date(y, mo - 1, dy); // local time, not UTC
    if (period === 'day') d.setDate(d.getDate() + 1);
    else if (period === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setDate(toDateStr(d));
  }, [date, period]);

  const goToToday = useCallback(() => {
    setDate(toDateStr(new Date()));
  }, []);

  return { period, setPeriod, date, goBack, goForward, goToToday };
}
