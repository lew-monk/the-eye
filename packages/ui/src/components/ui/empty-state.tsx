import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { Button } from "./button"

const emptyStateVariants = cva(
  "flex flex-col items-center justify-center py-12 px-6 text-center",
  {
    variants: {
      size: {
        sm: "py-8",
        md: "py-12",
        lg: "py-16",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
)

const SCRAMBLE_GLYPHS = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`0123456789ABCDEF"

function randomGlyph(): string {
  return SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)] ?? " "
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return reduced
}

type GlitchPhase = "burst" | "decode" | "settle" | "done"

function GlitchHeading({ text, reducedMotion }: { text: string; reducedMotion: boolean }) {
  const [phase, setPhase] = React.useState<GlitchPhase>(
    reducedMotion ? "done" : "burst",
  )
  const [decodedCount, setDecodedCount] = React.useState(0)
  const rafRef = React.useRef<number>(0)
  const startRef = React.useRef<number>(0)

  React.useEffect(() => {
    if (reducedMotion) return

    const tBurst = setTimeout(() => {
      setPhase("decode")
      startRef.current = 0
    }, 150)
    const tSettle = setTimeout(() => setPhase("settle"), 450)
    const tDone = setTimeout(() => setPhase("done"), 560)

    return () => {
      clearTimeout(tBurst)
      clearTimeout(tSettle)
      clearTimeout(tDone)
    }
  }, [reducedMotion])

  React.useEffect(() => {
    if (phase !== "decode") {
      cancelAnimationFrame(rafRef.current)
      return
    }

    const totalChars = text.length
    const decodeDuration = 300
    const perCharMs = Math.max(decodeDuration / totalChars, 16)

    function tick(now: number) {
      if (!startRef.current) startRef.current = now
      const elapsed = now - startRef.current
      const resolved = Math.min(Math.floor(elapsed / perCharMs), totalChars)
      setDecodedCount(resolved)
      if (resolved < totalChars) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase, text.length])

  const chars = text.split("")

  return (
    <h3
      aria-label={text}
      className="font-mono text-sm font-bold tracking-[0.2em] text-on-surface empty-state-heading-text mb-4 select-none"
    >
      <span aria-hidden="true">
        {chars.map((char, i) => {
          if (phase === "done" || i < decodedCount || phase === "burst") {
            return (
              <span key={i} className="empty-state-decode-char empty-state-decode-char--locked">
                {char}
              </span>
            )
          }
          return (
            <span key={i} className="empty-state-decode-char empty-state-decode-char--scrambling">
              {randomGlyph()}
            </span>
          )
        })}
      </span>
    </h3>
  )
}

export interface EmptyStateAction {
  label: string
  onAction: () => void
}

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof emptyStateVariants> {
  heading?: string
  body?: string
  icon?: React.ReactNode
  action?: EmptyStateAction
}

function EmptyState({
  className,
  size,
  heading,
  body,
  icon,
  action,
  ...props
}: EmptyStateProps) {
  const reducedMotion = useReducedMotion()
  const [phase, setPhase] = React.useState<GlitchPhase>(
    reducedMotion ? "done" : "burst",
  )

  React.useEffect(() => {
    if (reducedMotion) return
    const t1 = setTimeout(() => setPhase("decode"), 150)
    const t2 = setTimeout(() => setPhase("settle"), 450)
    const t3 = setTimeout(() => setPhase("done"), 560)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [reducedMotion])

  const phaseClass = reducedMotion ? "" : `empty-state-${phase}`

  return (
    <div className={cn(emptyStateVariants({ size }), phaseClass, className)} {...props}>
      <div className="empty-state-icon-well" aria-hidden="true">
        {icon ?? <span className="font-mono leading-none mt-0.5">&#8999;</span>}
      </div>

      <div className="empty-state-heading-area">
        {heading && <GlitchHeading text={heading} reducedMotion={reducedMotion} />}
      </div>

      {body && <p className="empty-state-body">{body}</p>}

      {action && (
        <Button
          variant={action.label === "CLEAR_FILTERS" ? "ghost" : "default"}
          size="sm"
          onClick={action.onAction}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
EmptyState.displayName = "EmptyState"

const VARIANT_PRESETS: Record<string, { heading: string; body: string; actionLabel?: string }> = {
  "no-documents": {
    heading: "NO_DOCUMENTS",
    body: "No documents have been uploaded to this case yet.",
    actionLabel: "UPLOAD_DOCUMENT",
  },
  "no-entities": {
    heading: "NO_ENTITIES_DETECTED",
    body: "No participants have been identified yet — upload a document or add one manually.",
    actionLabel: "ADD_PARTICIPANT",
  },
  "awaiting-analysis": {
    heading: "AWAITING_ANALYSIS",
    body: "This document hasn't finished processing — chunks will appear here once scoring completes.",
  },
  "no-matches": {
    heading: "NO_MATCHES",
    body: "Nothing matches the current filters — try adjusting your search.",
    actionLabel: "CLEAR_FILTERS",
  },
  "no-cases": {
    heading: "NO_ACTIVE_CASES",
    body: "No cases to display. Start a new operation to begin.",
    actionLabel: "NEW_OP",
  },
}

export interface EmptyStatePresetProps
  extends Omit<EmptyStateProps, "heading" | "body" | "action"> {
  variant: keyof typeof VARIANT_PRESETS
  onAction?: () => void
}

function EmptyStatePreset({ variant, onAction, ...props }: EmptyStatePresetProps) {
  const preset = VARIANT_PRESETS[variant]!
  const action = preset.actionLabel && onAction
    ? { label: preset.actionLabel, onAction }
    : undefined

  return (
    <EmptyState
      heading={preset.heading}
      body={preset.body}
      {...(action ? { action } : {})}
      {...props}
    />
  )
}
EmptyStatePreset.displayName = "EmptyStatePreset"

export { EmptyState, EmptyStatePreset, emptyStateVariants, VARIANT_PRESETS }
