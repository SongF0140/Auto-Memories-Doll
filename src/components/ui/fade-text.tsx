"use client";

import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

interface FadeTextProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function FadeText({ children, className, delay = 0 }: FadeTextProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(className)}
    >
      {children}
    </motion.div>
  );
}
