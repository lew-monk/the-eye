import * as React from "react"

import { cn } from "../../lib/utils"

export interface InputFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  label?: string
  error?: string
}

const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  ({ className, icon, label, error, type, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground text-left">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/60">
              {icon}
            </span>
          )}
          <input
            type={type}
            className={cn(
              "flex h-10 w-full bg-surface-container-low border-b border-primary/30 px-3 py-2 font-mono text-sm text-foreground placeholder:text-outline/30 focus:border-primary focus:outline-none transition-colors",
              icon && "pl-10",
              error && "border-destructive",
              className
            )}
            ref={ref}
            {...props}
          />
        </div>
        {error && (
          <p className="font-mono text-xs text-destructive">{error}</p>
        )}
      </div>
    )
  }
)
InputField.displayName = "InputField"

export { InputField }
