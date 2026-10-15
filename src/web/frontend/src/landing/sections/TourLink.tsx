import { useReducedMotion } from 'motion/react';
import { forwardRef, type AnchorHTMLAttributes } from 'react';

/** A link to the tour that glides there; without script it is a plain anchor. */
export const TourLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function TourLink({ onClick, ...props }, ref) {
  const reduce = useReducedMotion();
  return (
    <a
      ref={ref}
      href="#tour"
      onClick={event => {
        onClick?.(event);
        const tour = document.getElementById('tour');
        if (!tour || event.defaultPrevented) return;
        event.preventDefault();
        tour.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        history.replaceState(null, '', '#tour');
      }}
      {...props}
    />
  );
});
