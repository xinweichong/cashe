import { useEffect, useState } from 'react';

// Below Tailwind's `md` breakpoint (768px): the phone layout, where each tab
// is one non-scrolling screen (PhoneScreen + LensBar + DrillSheet). Tablet
// and desktop keep their own compositions, so pages mount exactly one layout
// rather than hiding a duplicate behind CSS.
const PHONE_QUERY = '(max-width: 767px)';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => hasMatchMedia() && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isPhone;
}
