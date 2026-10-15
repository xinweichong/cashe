// Motion tokens for the landing page. The curve is the app's ease-out-expo
// (lib/motionPresets.ts); the springs are tuned for this page.

export { EASE_OUT_EXPO as EASE_OUT } from '@/lib/motionPresets';

/** Content arriving in place: rows, cards, bubbles. */
export const SPRING_LAND = { type: 'spring', stiffness: 380, damping: 32, mass: 0.7 } as const;

/** The selected pill gliding between steps: no overshoot. */
export const SPRING_GLIDE = { type: 'spring', stiffness: 245, damping: 36, mass: 1.2 } as const;
