import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const statusDotVariants = cva(
  "inline-block rounded-full",
  {
    variants: {
      variant: {
        default: "bg-primary",
        success: "bg-green-500",
        warning: "bg-amber-500",
        error: "bg-destructive",
        muted: "bg-muted-foreground",
      },
      size: {
        sm: "h-1.5 w-1.5",
        md: "h-2 w-2",
        lg: "h-3 w-3",
      },
      pulse: {
        true: "animate-pulse",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
      pulse: false,
    },
  }
)

export interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusDotVariants> {}

const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, variant, size, pulse, ...props }, ref) => {
    return (
      <span
        className={cn(statusDotVariants({ variant, size, pulse, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
StatusDot.displayName = "StatusDot"

export { StatusDot, statusDotVariants }
