"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface StateIconProps {
  size?: number;
  color?: string;
  className?: string;
}

/* ─── Controlled TogglePaid ─── for paid/unpaid session toggle */
export function TogglePaid({
  checked,
  size = 40,
  className,
}: {
  checked: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={cn("", className)}
      style={{ width: size, height: size }}
    >
      <motion.rect
        x="5" y="13" width="30" height="14" rx="7"
        animate={checked
          ? { fill: "#10b981", opacity: 0.2 }
          : { fill: "#f59e0b", opacity: 0.12 }}
        transition={{ duration: 0.3 }}
      />
      <rect
        x="5" y="13" width="30" height="14" rx="7"
        stroke={checked ? "#10b981" : "#f59e0b"}
        strokeWidth={2}
      />
      <motion.circle
        cy="20" r="5"
        fill={checked ? "#10b981" : "#f59e0b"}
        animate={{ cx: checked ? 28 : 12 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
      />
    </svg>
  );
}

/* ─── Auto-demo icons below (for reference) ─── */
/* ─── 1. LOADING → SUCCESS ─── */
export function SuccessIcon({ size = 40, color = "currentColor", className }: StateIconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      <circle cx="20" cy="20" r="16" stroke={color} strokeWidth={2} />
      <path d="M12 20l6 6 10-12" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── 2. PLAY → PAUSE ─── */
export function PlayPauseIcon({ size = 40, color = "currentColor", className }: StateIconProps & { playing?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      <polygon points="14,10 30,20 14,30" fill={color} />
    </svg>
  );
}

/* ─── Toggle (generic controlled) ─── */
export function ToggleIcon({ checked, size = 40, color = "currentColor", className }: StateIconProps & { checked: boolean }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={cn("", className)} style={{ width: size, height: size }}>
      <motion.rect
        x="5" y="13" width="30" height="14" rx="7"
        animate={checked ? { fill: color, opacity: 0.2 } : { fill: color, opacity: 0.08 }}
        transition={{ duration: 0.3 }}
      />
      <rect x="5" y="13" width="30" height="14" rx="7" stroke={color} strokeWidth={2} opacity={checked ? 1 : 0.4} />
      <motion.circle
        cy="20" r="5" fill={color}
        animate={{ cx: checked ? 28 : 12 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
      />
    </svg>
  );
}

export { AnimatePresence };
