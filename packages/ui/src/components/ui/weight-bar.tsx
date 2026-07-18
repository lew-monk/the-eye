import { cn } from '../../lib/utils'

interface WeightBarProps {
	value: number
	density?: 'standard' | 'compact'
	className?: string
}

export function WeightBar({ value, density = 'standard', className }: WeightBarProps) {
	const clamped = Math.max(0, Math.min(1, value))
	const percent = Math.round(clamped * 100)
	const fillClass =
		percent > 50
			? 'bg-primary'
			: 'bg-primary/40'

	const isCompact = density === 'compact'

	return (
		<div className={cn('flex items-center gap-2', className)}>
			<div
				className={cn(
					'flex-1 bg-surface-container-high rounded-none overflow-hidden',
					isCompact ? 'h-0.5' : 'h-1',
				)}
			>
				<div
					className={cn('h-full rounded-none transition-all duration-500', fillClass)}
					style={{ width: `${percent}%` }}
				/>
			</div>
			<span
				className={cn(
					'font-mono tabular-nums text-outline text-right shrink-0',
					isCompact ? 'text-meta w-8' : 'text-body w-10',
				)}
			>
				{clamped.toFixed(2)}
			</span>
		</div>
	)
}
