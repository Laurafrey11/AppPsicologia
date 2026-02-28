"use client"

import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

interface WaveTextProps {
  text: string
  className?: string
}

export function WaveText({ text, className = "" }: WaveTextProps) {
  return (
    <motion.span
      className={cn("inline-block cursor-default", className)}
      whileHover="hover"
      initial="initial"
    >
      {text.split("").map((char, index) => (
        <motion.span
          key={index}
          className="inline-block"
          variants={{
            initial: { y: 0, scale: 1 },
            hover: {
              y: -4,
              scale: 1.15,
              transition: {
                type: "spring",
                stiffness: 300,
                damping: 15,
                delay: index * 0.03,
              },
            },
          }}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </motion.span>
  )
}
