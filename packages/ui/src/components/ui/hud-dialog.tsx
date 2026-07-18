import * as React from "react"
import { createPortal } from "react-dom"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const HudDialogStackContext = React.createContext<{
	stack: number
	push: () => number
	pop: () => void
}>({ stack: 0, push: () => 0, pop: () => {} })

export function HudDialogProvider({ children }: { children: React.ReactNode }) {
	const [stack, setStack] = React.useState(0)
	const stackRef = React.useRef(0)

	const push = React.useCallback(() => {
		stackRef.current += 1
		setStack(stackRef.current)
		return stackRef.current
	}, [])

	const pop = React.useCallback(() => {
		stackRef.current = Math.max(0, stackRef.current - 1)
		setStack(stackRef.current)
	}, [])

	return (
		<HudDialogStackContext.Provider value={{ stack, push, pop }}>
			{children}
		</HudDialogStackContext.Provider>
	)
}

export function useHudDialogStack() {
	return React.useContext(HudDialogStackContext)
}

const dialogVariants = cva(
	"relative w-full font-mono",
	{
		variants: {
			size: {
				sm: "max-w-[420px]",
				md: "max-w-[560px]",
				lg: "max-w-[720px]",
			},
		},
		defaultVariants: {
			size: "md",
		},
	}
)

const backdropVariants = cva(
	"fixed inset-0 flex items-center justify-center transition-opacity duration-300",
	{
		variants: {
			state: {
				open: "opacity-100",
				closed: "opacity-0 pointer-events-none",
			},
		},
		defaultVariants: {
			state: "closed",
		},
	}
)

const panelVariants = cva(
	"transition-all duration-300 border outline-1 outline outline-outline bg-surface-container-high overflow-hidden",
	{
		variants: {
			state: {
				open: "scale-100 opacity-100",
				closed: "scale-95 opacity-0",
			},
		},
		defaultVariants: {
			state: "closed",
		},
	}
)

const reducedMotionPanel = "transition-opacity duration-300 bg-surface-container-high border border-outline overflow-hidden"

export interface HudDialogProps
	extends VariantProps<typeof dialogVariants> {
	open: boolean
	onOpenChange: (open: boolean) => void

	title: string
	indexCode?: string

	variant: "confirm" | "destructive" | "form" | "informational"

	primaryActionLabel?: string
	onPrimaryAction?: () => void | Promise<void>

	closeLabel?: string
	loading?: boolean
	primaryDisabled?: boolean
	primaryDisabledReason?: string

	children: React.ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

function useFocusTrap(containerRef: React.RefObject<HTMLDivElement | null>, open: boolean) {
	const previousFocusRef = React.useRef<HTMLElement | null>(null)

	React.useEffect(() => {
		if (!open) return
		previousFocusRef.current = document.activeElement as HTMLElement

		const container = containerRef.current
		if (!container) return

		const raf = requestAnimationFrame(() => {
			const cancelBtn = container.querySelector('[data-hud-dialog-close]') as HTMLElement | null
			if (cancelBtn) {
				cancelBtn.focus()
			}
		})

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return
			const focusable = container.querySelectorAll(FOCUSABLE)
			const first = focusable[0] as HTMLElement | undefined
			const last = focusable[focusable.length - 1] as HTMLElement | undefined
			if (!first || !last) return

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault()
					last.focus()
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault()
					first.focus()
				}
			}
		}

		document.addEventListener("keydown", handleKeyDown)
		return () => {
			cancelAnimationFrame(raf)
			document.removeEventListener("keydown", handleKeyDown)
		}
	}, [open, containerRef])

	React.useEffect(() => {
		if (!open && previousFocusRef.current) {
			previousFocusRef.current.focus()
			previousFocusRef.current = null
		}
	}, [open])
}

function HudDialog({
	open,
	onOpenChange,
	title,
	indexCode,
	variant,
	primaryActionLabel,
	onPrimaryAction,
	closeLabel,
	loading = false,
	primaryDisabled = false,
	primaryDisabledReason,
	children,
	size,
}: HudDialogProps) {
	const panelRef = React.useRef<HTMLDivElement>(null)
	const [animating, setAnimating] = React.useState(false)
	const [visible, setVisible] = React.useState(false)
	const [prefersReduced, setPrefersReduced] = React.useState(false)

	useFocusTrap(panelRef, open)

	React.useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
		setPrefersReduced(mq.matches)
		const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches)
		mq.addEventListener("change", handler)
		return () => mq.removeEventListener("change", handler)
	}, [])

	React.useEffect(() => {
		if (open) {
			setVisible(true)
			requestAnimationFrame(() => setAnimating(true))
			document.body.style.overflow = "hidden"
			return
		}
		setAnimating(false)
		const timer = setTimeout(() => {
			setVisible(false)
			document.body.style.overflow = ""
		}, 300)
		return () => {
			clearTimeout(timer)
			document.body.style.overflow = ""
		}
	}, [open])

	React.useEffect(() => {
		if (!open) return
		const handleEsc = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onOpenChange(false)
			}
		}
		document.addEventListener("keydown", handleEsc)
		return () => document.removeEventListener("keydown", handleEsc)
	}, [open, onOpenChange])

	const handleClose = React.useCallback(() => {
		onOpenChange(false)
	}, [onOpenChange])

	const [isSubmitting, setIsSubmitting] = React.useState(false)
	const isBusy = loading || isSubmitting

	const handlePrimary = React.useCallback(async () => {
		if (!onPrimaryAction) return
		setIsSubmitting(true)
		try {
			await onPrimaryAction()
		} finally {
			setIsSubmitting(false)
		}
	}, [onPrimaryAction])

	const backdropClosable = variant === "confirm" || variant === "informational"

	const handleBackdropClick = React.useCallback(() => {
		if (backdropClosable) {
			onOpenChange(false)
		}
	}, [backdropClosable, onOpenChange])

	const { push, pop } = useHudDialogStack()
	const [stackLevel, setStackLevel] = React.useState(0)

	React.useEffect(() => {
		if (open) {
			setStackLevel(push())
		}
	}, [open, push])

	React.useEffect(() => {
		return () => {
			if (open) pop()
		}
	}, [open, pop])

	if (!visible) return null

	const resolvedCloseLabel =
		closeLabel ??
		(variant === "informational" ? "CLOSE" : "CANCEL")

	const isDestructive = variant === "destructive"

	const dialogElement = (
		<div
			className={cn(
				backdropVariants({ state: animating ? "open" : "closed" }),
			)}
			style={{
				background: "rgba(10, 14, 23, 0.6)",
				backdropFilter: "blur(20px)",
				WebkitBackdropFilter: "blur(20px)",
				zIndex: 9990 + stackLevel,
			}}
			onClick={handleBackdropClick}
		>
			<div className={cn("relative w-full", dialogVariants({ size }))} style={{ transform: stackLevel > 1 ? `translate(${(stackLevel - 1) * 24}px, ${(stackLevel - 1) * 24}px)` : undefined }}>
				<span className="absolute pointer-events-none z-10" style={{ top: -6, left: -6, width: 20, height: 20, borderTop: "2px solid var(--color-primary, #4df6e0)", borderLeft: "2px solid var(--color-primary, #4df6e0)" }} />
				<span className="absolute pointer-events-none z-10" style={{ bottom: -6, right: -6, width: 20, height: 20, borderBottom: "2px solid var(--color-primary, #4df6e0)", borderRight: "2px solid var(--color-primary, #4df6e0)" }} />

				<div
					className={cn(
						prefersReduced ? reducedMotionPanel : panelVariants({ state: animating ? "open" : "closed" }),
					)}
					onClick={(e) => e.stopPropagation()}
					ref={panelRef}
					role="dialog"
					aria-modal="true"
					aria-label={title}
				>

				{/* Header */}
				<div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/50">
					<div className="flex items-center gap-3 min-w-0">
						{indexCode && (
							<span className="font-mono text-body uppercase tracking-[0.15em] text-primary/60 bg-primary/5 px-2 py-0.5 border border-primary/20 shrink-0">
								{indexCode}
							</span>
						)}
						<span className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant truncate">
							{title}
						</span>
					</div>
					<button
						type="button"
						className={cn(
							"flex items-center justify-center w-7 h-7 text-outline hover:text-on-surface transition-colors",
							"hover:bg-accent/50",
						)}
						onClick={handleClose}
						aria-label="Close dialog"
						data-hud-dialog-close
					>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</button>
				</div>

				{/* Body */}
				<div
					className={cn(
						"px-5 py-4 text-body-lg leading-relaxed text-on-surface-variant",
						variant === "form" && "max-h-[60vh] overflow-y-auto",
					)}
				>
					{children}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-outline-variant/50">
					<button
						type="button"
						disabled={isBusy}
						className={cn(
							"font-mono text-body uppercase tracking-[0.12em] px-4 py-2 transition-all duration-200",
							"border outline-1 outline outline-outline/40 bg-transparent text-outline",
							"hover:bg-primary/10 hover:text-primary hover:border-primary/50",
							"disabled:opacity-40 disabled:cursor-not-allowed",
							isBusy && "opacity-40 cursor-not-allowed",
						)}
						onClick={handleClose}
						data-hud-dialog-close
					>
						{resolvedCloseLabel}
					</button>
					{primaryActionLabel && onPrimaryAction && (
						<button
							type="button"
							disabled={isBusy || primaryDisabled}
							className={cn(
								"font-mono text-body uppercase tracking-[0.12em] px-4 py-2 transition-all duration-200",
								isDestructive
									? "bg-error text-on-error hover:bg-error/90 shadow-[0_0_20px_-4px_rgba(255,180,171,0.3)]"
									: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_-4px_rgba(77,246,224,0.3)]",
								"disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
								isBusy && "opacity-60 cursor-wait",
							)}
							onClick={handlePrimary}
							title={primaryDisabled && primaryDisabledReason ? primaryDisabledReason : undefined}
						>
							{isBusy ? (
								<span className="inline-flex items-center gap-1.5">
									<svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
										<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
										<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
									</svg>
									{primaryActionLabel.replace(/_/g, " ")}…
								</span>
							) : (
								primaryActionLabel.replace(/_/g, " ")
							)}
						</button>
					)}
				</div>
			</div>
			</div>
		</div>
	)

	return createPortal(dialogElement, document.body)
}

HudDialog.displayName = "HudDialog"

export { HudDialog, dialogVariants }
