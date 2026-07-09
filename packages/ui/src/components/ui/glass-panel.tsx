import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const glassPanelVariants = cva(
  "",
  {
    variants: {
      variant: {
        default: "glass-panel",
        solid: "bg-card border border-border",
        glow: "glass-panel shadow-[0_0_50px_-12px_rgba(77,246,224,0.15)]",
      },
      brackets: {
        none: "",
        top: "bracket-top-left",
        bottom: "bracket-bottom-right",
        both: "bracket-top-left bracket-bottom-right",
      },
      padding: {
        none: "",
        sm: "p-4",
        md: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: {
      variant: "default",
      brackets: "none",
      padding: "md",
    },
  }
)

export interface GlassPanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassPanelVariants> {}

const GlassPanel = React.forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, variant, brackets, padding, ...props }, ref) => {
    return (
      <div
        className={cn(glassPanelVariants({ variant, brackets, padding, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
GlassPanel.displayName = "GlassPanel"

export { GlassPanel, glassPanelVariants }
