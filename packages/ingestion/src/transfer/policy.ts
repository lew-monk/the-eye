export interface BackoffOptions {
	baseMs: number
	maxMs: number
	/** attempt is 1-based (first retry after first failure). */
	attempt: number
	jitterRatio?: number
	rng?: () => number
}

/** Pure exponential backoff: base * 2^(attempt-1), capped at maxMs, ±jitter. */
export function computeBackoff(options: BackoffOptions): number {
	const { baseMs, maxMs, attempt } = options
	const jitterRatio = options.jitterRatio ?? 0.2
	const rng = options.rng ?? Math.random
	const safeAttempt = Math.max(1, Math.floor(attempt))
	const grown = baseMs * 2 ** (safeAttempt - 1)
	const capped = Math.min(grown, Math.max(maxMs, 1))
	const jitter = (rng() * 2 - 1) * jitterRatio * capped
	return Math.max(0, Math.round(capped + jitter))
}

export interface RetryPolicy {
	maxAttempts: number
	baseMs: number
	maxMs: number
	jitterRatio?: number
}

export function shouldRetry(attemptsMade: number, policy: RetryPolicy): boolean {
	return attemptsMade < policy.maxAttempts
}

export function retryDelayMs(attemptsMade: number, policy: RetryPolicy, rng?: () => number): number {
	// attemptsMade counts failures so far; next attempt number is attemptsMade+1.
	const base: BackoffOptions = {
		baseMs: policy.baseMs,
		maxMs: policy.maxMs,
		attempt: attemptsMade + 1,
		jitterRatio: policy.jitterRatio ?? 0.2,
	}
	if (rng !== undefined) base.rng = rng
	return computeBackoff(base)
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxAttempts: 5,
	baseMs: 500,
	maxMs: 30_000,
	jitterRatio: 0.2,
}
