import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-sm font-medium uppercase tracking-wider transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default:
					"bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 shadow-[0_0_20px_-4px_rgba(77,246,224,0.3)]",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-95",
				outline:
					"border border-input bg-background hover:bg-accent hover:text-accent-foreground",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-95",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
				glow:
					"border border-primary/30 bg-transparent text-primary hover:bg-primary/10 hover:border-primary/50",
			},
			size: {
				default: "h-10 px-4 py-2",
				sm: "h-8  px-3 text-xs",
				lg: "h-12 px-8 text-base",
				icon: "h-10 w-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	}
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
	VariantProps<typeof buttonVariants> {
	asChild?: boolean
	brackets?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, brackets = true, children, ...props }, ref) => {
		const Comp = asChild ? Slot : "button"

		if (!brackets || asChild) {
			return (
				<Comp
					className={cn(buttonVariants({ variant, size, className }))}
					ref={ref}
					{...props}
				>
					{children}
				</Comp>
			)
		}

		return (
			<Comp
				className={cn(
					buttonVariants({ variant, size }),
					"relative",
"before:content-[''] before:absolute before:-top-1 before:-left-1 before:w-3 before:h-3 before:border-t-[1.5px] before:border-l-[1.5px] before:border-white/60 before:pointer-events-none",
					"after:content-[''] after:absolute after:-bottom-1 after:-right-1 after:w-3 after:h-3 after:border-b-[1.5px] after:border-r-[1.5px] after:border-white/60 after:pointer-events-none",
					className
				)}
				ref={ref}
				{...props}
			>
				{children}
			</Comp>
		)
	}
)
Button.displayName = "Button"

export { Button, buttonVariants }
