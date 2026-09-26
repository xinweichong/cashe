import { Navigate, useLocation } from 'react-router-dom';

export function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const location = useLocation();
  return <Navigate replace to={`${to}${location.pathname.slice(from.length)}${location.search}${location.hash}`} />;
}
