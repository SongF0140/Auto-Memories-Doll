"use client";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "error";
}

export default function Badge({ children, variant = "default" }: BadgeProps) {
  const variantClasses = {
    default: "bg-muted text-text-secondary",
    success: "bg-success-bg text-success",
    error: "bg-error-bg text-error",
  };

  return (
    <span className={`badge ${variantClasses[variant]}`}>
      {children}
    </span>
  );
}
