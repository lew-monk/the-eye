import retry from 'p-retry'

export interface RetryOptions {
	retries?: number
	minTimeout?: number
	maxTimeout?: number
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {}
): Promise<T> {
	const { retries = 3, minTimeout = 1000, maxTimeout = 10000 } = options

	return retry(fn, {
		retries,
		minTimeout,
		maxTimeout,
		onFailedAttempt: (error) => {
			console.warn(`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`)
		},
	})
}
