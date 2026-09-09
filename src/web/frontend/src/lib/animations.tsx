// src/web/frontend/src/lib/animations.tsx
import { useEffect } from 'react'
import { animate, useMotionValue, useTransform, motion } from 'framer-motion'
import { formatCurrency } from './utils'
import { springs } from './motionPresets'

// ─── Animated currency number ─────────────────────────────────────────────────
// Counts from 0 to `value` on mount and whenever `value` changes.
interface AnimatedCurrencyProps {
  value: number
  currency?: string
}

export function AnimatedCurrency({ value, currency = 'SGD' }: AnimatedCurrencyProps) {
  const motionValue = useMotionValue(0)
  const formatted = useTransform(motionValue, (v) => formatCurrency(v, currency))

  useEffect(() => {
    const controls = animate(motionValue, value, { duration: 0.7, ease: 'easeOut' })
    return controls.stop
  }, [value, motionValue])

  return <motion.span>{formatted}</motion.span>
}

// ─── Delta badge ─────────────────────────────────────────────────────────────
// value = signed percentage vs prior period (positive = more spend = worse for expenses)
interface DeltaBadgeProps {
  value: number
  label?: string
  invert?: boolean  // set true when more = good (income, savings)
}

export function DeltaBadge({ value, label, invert = false }: DeltaBadgeProps) {
  const isUp = value >= 0
  const isBad = invert ? !isUp : isUp
  const color = isBad ? '#FF6B6B' : '#34D399'
  const arrow = isUp ? '▲' : '▼'
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={springs.bouncy}
      className="inline-flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full"
      style={{ color, background: `${color}1A` }}
    >
      {arrow}{Math.abs(value).toFixed(1)}%{label ? ` ${label}` : ''}
    </motion.span>
  )
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
}

export function Sparkline({ data, color = '#00D4AA', width = 60, height = 24 }: SparklineProps) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
