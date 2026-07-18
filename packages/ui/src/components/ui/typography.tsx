import { forwardRef, type HTMLAttributes } from "react"
import { cn } from "../../lib/utils"

export const fontSizes = {
	"meta-sm": "text-meta-sm",
	meta: "text-meta",
	body: "text-body",
	"body-lg": "text-body-lg",
} as const

export type FontSize = keyof typeof fontSizes

interface TextProps extends HTMLAttributes<HTMLSpanElement> {
	size?: FontSize
	mono?: boolean
}

export const Text = forwardRef<HTMLSpanElement, TextProps>(
	({ className, size = "body", mono = true, ...props }, ref) => {
		return (
			<span
				ref={ref}
				className={cn(
					fontSizes[size],
					mono && "font-mono",
					className,
				)}
				{...props}
			/>
		)
	},
)
Text.displayName = "Text"
