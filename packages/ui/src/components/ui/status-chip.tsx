import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"
import { StatusDot } from "./status-dot"

const statusChipVariants = cva(
  "inline-flex items-center gap-1.5 rounded font-mono uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary border border-primary/20",
        success: "bg-green-500/10 text-green-400 border border-green-500/20",
        warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
        error: "bg-destructive/10 text-destructive border border-destructive/20",
        secondary: "bg-secondary/10 text-secondary border border-secondary/20",
        muted: "bg-muted text-muted-foreground border border-border",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[10px]",
        md: "px-2 py-1 text-xs",
        lg: "px-3 py-1.5 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
)

export interface StatusChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusChipVariants> {
  dot?: boolean
  dotVariant?: "default" | "success" | "warning" | "error" | "muted"
}

const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  ({ className, variant, size, dot = true, dotVariant, children, ...props }, ref) => {
    const resolvedDotVariant = dotVariant ?? (variant === "success" ? "success" : variant === "warning" ? "warning" : variant === "error" ? "error" : variant === "muted" ? "muted" : "default")

    return (
      <span
        className={cn(statusChipVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {dot && <StatusDot variant={resolvedDotVariant} size="sm" />}
        {children}
      </span>
    )
  }
)
StatusChip.displayName = "StatusChip"

export { StatusChip, statusChipVariants }
