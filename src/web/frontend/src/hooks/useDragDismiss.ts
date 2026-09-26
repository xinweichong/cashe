import { useReducedMotion, type PanInfo } from 'framer-motion';

const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 500;

// Drag props for a panel that slides in from the right: dragging it right
// far or fast enough closes it. Off under reduced motion (or `enabled`).
export function useDragDismiss(onDismiss: () => void, enabled = true) {
  const reduceMotion = useReducedMotion();
  return {
    drag: enabled && !reduceMotion ? ('x' as const) : false,
    dragDirectionLock: true,
    dragConstraints: { left: 0, right: 0 },
    dragElastic: { left: 0, right: 0.9 },
    onDragEnd: (_: unknown, info: PanInfo) => {
      if (info.offset.x > DISMISS_DISTANCE || info.velocity.x > DISMISS_VELOCITY) onDismiss();
    },
  };
}
