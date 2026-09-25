import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

// The phone's drill-in state, held in the URL. Opening pushes a history
// entry, so the phone's own back gesture closes the DrillSheet; a drill
// reached by deep link has nothing to go back to, so closing clears it.
export function useDrill<T extends string>(allowed: readonly T[], param = 'drill') {
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const raw = search.get(param) as T | null;
  const drill = raw && allowed.includes(raw) ? raw : null;

  const openDrill = (next: T, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(search);
    params.set(param, next);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    setSearch(params, { state: { drill: true } });
  };
  const closeDrill = (alsoClear: string[] = []) => {
    if ((location.state as { drill?: boolean } | null)?.drill) { navigate(-1); return; }
    const params = new URLSearchParams(search);
    params.delete(param);
    for (const key of alsoClear) params.delete(key);
    setSearch(params, { replace: true });
  };
  return { drill, openDrill, closeDrill };
}
