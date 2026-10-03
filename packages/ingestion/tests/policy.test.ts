import { describe, expect, test } from 'bun:test'
import { computeBackoff, shouldRetry, retryDelayMs } from '../src/transfer/policy'

describe('transfer/policy — backoff math (retry-storm bugs)', () => {
	test('grows exponentially then caps at maxMs', () => {
		const noJitter = () => 0.5
		expect(computeBackoff({ baseMs: 500, maxMs: 30_000, attempt: 1, jitterRatio: 0, rng: noJitter })).toBe(500)
		expect(computeBackoff({ baseMs: 500, maxMs: 30_000, attempt: 2, jitterRatio: 0, rng: noJitter })).toBe(1000)
		expect(computeBackoff({ baseMs: 500, maxMs: 30_000, attempt: 3, jitterRatio: 0, rng: noJitter })).toBe(2000)
		expect(computeBackoff({ baseMs: 500, maxMs: 1500, attempt: 10, jitterRatio: 0, rng: noJitter })).toBe(1500)
	})

	test('jitter stays within ±ratio bounds (deterministic rng)', () => {
		const base = computeBackoff({ baseMs: 1000, maxMs: 10_000, attempt: 2, jitterRatio: 0.2, rng: () => 1 })
		const low = computeBackoff({ baseMs: 1000, maxMs: 10_000, attempt: 2, jitterRatio: 0.2, rng: () => 0 })
		// attempt 2 → 2000 nominal; jitter ±20% → [1600, 2400]
		expect(base).toBe(2400)
		expect(low).toBe(1600)
	})

	test('attempt 0 / negative is clamped to 1 (no zero-delay hot loop)', () => {
		expect(computeBackoff({ baseMs: 500, maxMs: 30_000, attempt: 0, jitterRatio: 0, rng: () => 0.5 })).toBe(500)
	})

	test('shouldRetry stops at maxAttempts (off-by-one would retry forever)', () => {
		const policy = { maxAttempts: 3, baseMs: 100, maxMs: 1000 }
		expect(shouldRetry(0, policy)).toBe(true)
		expect(shouldRetry(2, policy)).toBe(true)
		expect(shouldRetry(3, policy)).toBe(false)
		expect(shouldRetry(99, policy)).toBe(false)
	})

	test('retryDelayMs maps failures→next-attempt (no double-count of backoff step)', () => {
		const policy = { maxAttempts: 5, baseMs: 500, maxMs: 30_000, jitterRatio: 0 }
		expect(retryDelayMs(0, policy, () => 0.5)).toBe(500)
		expect(retryDelayMs(1, policy, () => 0.5)).toBe(1000)
	})
})
