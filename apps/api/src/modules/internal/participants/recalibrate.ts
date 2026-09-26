export function recalibrateRelevance(
	docCount: number,
	totalDocs: number,
	baseScore: number | null,
): number {
	const base = baseScore ?? 0
	if (totalDocs <= 1) return base
	const bonus = ((docCount - 1) / totalDocs) * 0.5
	return Math.min(1, base + bonus)
}
