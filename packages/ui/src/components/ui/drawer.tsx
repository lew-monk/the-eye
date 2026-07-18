import * as React from "react"
import { createPortal } from "react-dom"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { useHudDialogStack } from "./hud-dialog"

const drawerVariants = cva(
	"fixed right-0 top-0 h-full font-mono border-l border-outline bg-surface overflow-hidden flex flex-col",
	{
		variants: {
			size: {
				sm: "w-[400px]",
				md: "w-[560px]",
				lg: "w-[720px]",
				full: "w-[90vw]",
			},
		},
		defaultVariants: {
			size: "md",
		},
	}
)

const backdropVariants = cva(
	"fixed inset-0 transition-opacity duration-300",
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
	"transition-all duration-300",
	{
		variants: {
			state: {
				open: "translate-x-0",
				closed: "translate-x-full",
			},
		},
		defaultVariants: {
			state: "closed",
		},
	}
)

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

function useFocusTrap(containerRef: React.RefObject<HTMLDivElement | null>, open: boolean) {
	const previousFocusRef = React.useRef<HTMLElement | null>(null)

	React.useEffect(() => {
		if (!open) return
		previousFocusRef.current = document.activeElement as HTMLElement

		const container = containerRef.current
		if (!container) return

		const raf = requestAnimationFrame(() => {
			const closeBtn = container.querySelector('[data-drawer-close]') as HTMLElement | null
			if (closeBtn) {
				closeBtn.focus()
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

export interface DrawerProps
	extends VariantProps<typeof drawerVariants> {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: string
	children: React.ReactNode
}

function Drawer({
	open,
	onOpenChange,
	title,
	children,
	size,
}: DrawerProps) {
	const panelRef = React.useRef<HTMLDivElement>(null)
	const [animating, setAnimating] = React.useState(false)
	const [visible, setVisible] = React.useState(false)

	useFocusTrap(panelRef, open)

	React.useEffect(() => {
		if (open) {
			setVisible(true)
			requestAnimationFrame(() => setAnimating(true))
			return
		}
		setAnimating(false)
		const timer = setTimeout(() => {
			setVisible(false)
		}, 300)
		return () => {
			clearTimeout(timer)
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

	const drawerElement = (
		<div
			className={cn(
				backdropVariants({ state: animating ? "open" : "closed" }),
			)}
			style={{
				background: "rgba(10, 14, 23, 0.6)",
				backdropFilter: "blur(12px)",
				WebkitBackdropFilter: "blur(12px)",
				zIndex: 9990 + stackLevel,
			}}
			onClick={handleClose}
		>
			<div
				className={cn(
					drawerVariants({ size }),
					panelVariants({ state: animating ? "open" : "closed" }),
				)}
				onClick={(e) => e.stopPropagation()}
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				style={{ zIndex: 9991 + stackLevel }}
			>
				<div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/50 shrink-0">
					<span className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant truncate">
						{title}
					</span>
					<button
						type="button"
						className="flex items-center justify-center w-7 h-7 text-outline hover:text-on-surface transition-colors hover:bg-accent/50"
						onClick={handleClose}
						aria-label="Close drawer"
						data-drawer-close
					>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
							<path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</button>
				</div>
				<style>{`
					[data-drawer-scroll]::-webkit-scrollbar {
						width: 12px;
					}
					[data-drawer-scroll]::-webkit-scrollbar-track {
						background: transparent;
					}
					[data-drawer-scroll]::-webkit-scrollbar-thumb {
						background: rgba(77, 246, 224, 0.3);
						border-radius: 6px;
						border: 3px solid transparent;
						background-clip: padding-box;
						min-height: 52px;
					}
					[data-drawer-scroll]::-webkit-scrollbar-thumb:hover {
						background: rgba(77, 246, 224, 0.5);
						background-clip: padding-box;
					}
				`}</style>
				<div className="flex-1 overflow-y-auto" data-drawer-scroll>
					{children}
				</div>
			</div>
		</div>
	)

	return createPortal(drawerElement, document.body)
}

Drawer.displayName = "Drawer"

export { Drawer, drawerVariants }
