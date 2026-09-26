import { createContext, useContext } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export const ThemeContext = createContext<{
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
}>({ preference: 'system', resolved: 'dark', setPreference: () => {} });

export function useTheme() { return useContext(ThemeContext); }
