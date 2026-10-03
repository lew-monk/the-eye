import { describe, expect, test } from 'bun:test'
import { chunkText, buildSummaryPrompt, resolveSummaryModel, hashText } from '../src/pipeline/meta'
import {
	judgmentJobId,
	judgmentJobOptions,
	JUDGMENTS_QUEUE,
	queueNameForCollection,
	ingestionQueuesForCollections,
} from '../src/pipeline/judgment-queue'
import { normalizeCollection, DEFAULT_COLLECTION } from '../src/jobs/types'

describe('pipeline/meta — chunking + summary prompt', () => {
	test('empty text yields no chunks (no phantom embedding jobs)', () => {
		expect(chunkText('')).toEqual([])
	})

	test('overlap preserves continuity between chunks', () => {
		const text = 'abcdefghij'
		const chunks = chunkText(text, 4, 2)
		expect(chunks).toEqual(['abcd', 'cdef', 'efgh', 'ghij'])
		// every adjacent pair shares the 2-char overlap
		for (let i = 1; i < chunks.length; i++) {
			expect((chunks[i] as string).startsWith((chunks[i - 1] as string).slice(-2))).toBe(true)
		}
	})

	test('invalid overlap throws (overlap >= size would loop forever)', () => {
		expect(() => chunkText('abc', 4, 4)).toThrow()
		expect(() => chunkText('abc', 0, 0)).toThrow()
	})

	test('summary prompt truncates long OCR (model context guard) and forbids invented cites', () => {
		const long = 'x'.repeat(20_000)
		const prompt = buildSummaryPrompt(long, 100)
		expect(prompt.length).toBeLessThan(1000)
		expect(prompt).toMatch(/Do not invent citations/)
		expect(prompt).toContain('x'.repeat(100))
		expect(prompt).not.toContain('x'.repeat(101))
	})

	test('hashText is stable (idempotent chunk dedup)', () => {
		expect(hashText('hello')).toBe(hashText('hello'))
		expect(hashText('hello')).not.toBe(hashText('world'))
	})

	test('resolveSummaryModel pins cheapest configured default', () => {
		expect(resolveSummaryModel({ SUMMARY_MODEL: 'custom' } as NodeJS.ProcessEnv)).toBe('custom')
		expect(resolveSummaryModel({ EMBEDDING_PROVIDER: 'ollama' } as NodeJS.ProcessEnv)).toBe('llama3.1:8b')
		expect(resolveSummaryModel({ EMBEDDING_PROVIDER: 'openai' } as NodeJS.ProcessEnv)).toBe('gpt-4o-mini')
	})

	test('judgment queue defs: stable id, retry defaults', () => {
		expect(JUDGMENTS_QUEUE).toBe('judgments')
		const id = judgmentJobId({ jobId: 'j', checksum: 'abc', storageKey: 'k', relativePath: 'a.pdf', collection: 'judgments' })
		expect(id).toBe('j_abc')
		// BullMQ rejects custom ids containing ':' — the dedup id must never include one.
		expect(id).not.toContain(':')
		const opts = judgmentJobOptions()
		expect(opts.attempts).toBe(5)
		expect(opts.backoff.type).toBe('exponential')
	})

	test('queue topology: default collection keeps judgments queue, others get own queue', () => {
		expect(queueNameForCollection('judgments')).toBe('judgments')
		expect(queueNameForCollection('JUDGMENTS')).toBe('judgments')
		expect(queueNameForCollection('contracts')).toBe('ingest:contracts')
		expect(queueNameForCollection('police-reports')).toBe('ingest:police-reports')
		expect(() => queueNameForCollection('../evil')).toThrow()
		expect(() => queueNameForCollection('')).toThrow()
		expect(() => queueNameForCollection('a/b')).toThrow()
	})

	test('ingestionQueuesForCollections dedupes (no double worker subscription)', () => {
		expect(ingestionQueuesForCollections(['judgments', 'contracts', 'contracts'])).toEqual([
			'judgments',
			'ingest:contracts',
		])
		expect(ingestionQueuesForCollections([])).toEqual([])
	})

	test('normalizeCollection defaults to judgments, lowercases, rejects traversal', () => {
		expect(DEFAULT_COLLECTION).toBe('judgments')
		expect(normalizeCollection(undefined)).toBe('judgments')
		expect(normalizeCollection('')).toBe('judgments')
		expect(normalizeCollection('  ')).toBe('judgments')
		expect(normalizeCollection('Contracts')).toBe('contracts')
		expect(() => normalizeCollection('../evil')).toThrow()
		expect(() => normalizeCollection('a/b')).toThrow()
		expect(() => normalizeCollection('x'.repeat(65))).toThrow()
	})
})
