"use client";

import React from "react";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "error";
  className?: string;
}

export default function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variantClasses = {
    default: "bg-muted text-text-secondary",
    success: "bg-success-bg text-success",
    error: "bg-error-bg text-error",
  };

  return <span className={`badge ${variantClasses[variant]} ${className}`}>{children}</span>;
}
