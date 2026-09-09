import { useEffect } from 'react'
import { animate, useMotionValue } from 'framer-motion'
import type { Variants } from 'framer-motion'

// ─── Spring presets ──────────────────────────────────────────────────────────
export const springs = {
  gentle: { type: 'spring' as const, stiffness: 200, damping: 25 },
  snappy: { type: 'spring' as const, stiffness: 350, damping: 30 },
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 20 },
  expo:   { type: 'tween'  as const, ease: [0.16, 1, 0.3, 1] as const, duration: 0.4 },
}

// ─── Page transition ─────────────────────────────────────────────────────────
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: springs.gentle },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.12, ease: 'easeIn' as const } },
}

// ─── Fade up (form expand, card entrance) ────────────────────────────────────
export const fadeUpVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: springs.gentle },
  exit:    { opacity: 0, y: 8,  transition: { duration: 0.12, ease: 'easeIn' as const } },
}

// ─── Slide in from right (detail panels) ─────────────────────────────────────
export const slideInRightVariants: Variants = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0, transition: springs.snappy },
  exit:    { opacity: 0, x: 32, transition: { duration: 0.15, ease: 'easeIn' as const } },
}

// ─── Slide up from bottom (BottomTabs drawer) ────────────────────────────────
export const slideUpVariants: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: springs.snappy },
  exit:    { y: '100%', transition: { duration: 0.2, ease: 'easeIn' as const } },
}

// ─── Stagger container ────────────────────────────────────────────────────────
export const staggerContainerVariants: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
}

// ─── Stagger item (child of staggerContainer) ─────────────────────────────────
export const staggerItemVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: springs.gentle },
  exit:    { opacity: 0, transition: { duration: 0.1 } },
}

// ─── Count-up hook ────────────────────────────────────────────────────────────
export function useCountUp(target: number, duration = 0.7) {
  const motionValue = useMotionValue(0)
  useEffect(() => {
    const controls = animate(motionValue, target, { duration, ease: 'easeOut' })
    return controls.stop
  }, [target, motionValue, duration])
  return motionValue
}
