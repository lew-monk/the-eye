import { describe, expect, test } from 'bun:test'
import { canTransitionFile, canTransitionJob, assertFileTransition } from '../src/jobs/types'

describe('jobs/types — state-machine transitions (illegal-skip bugs)', () => {
	test('happy path is legal', () => {
		expect(canTransitionFile('discovered', 'staged')).toBe(true)
		expect(canTransitionFile('staged', 'uploaded')).toBe(true)
		expect(canTransitionFile('uploaded', 'ocr')).toBe(true)
		expect(canTransitionFile('ocr', 'embedded')).toBe(true)
		expect(canTransitionFile('embedded', 'summarized')).toBe(true)
	})

	test('skipping stages is illegal (catches upload→summarized shortcut)', () => {
		expect(canTransitionFile('discovered', 'uploaded')).toBe(false)
		expect(canTransitionFile('staged', 'summarized')).toBe(false)
		expect(canTransitionFile('uploaded', 'summarized')).toBe(false)
	})

	test('terminal summarized has no outgoing edges', () => {
		for (const to of ['staged', 'uploaded', 'ocr', 'embedded', 'summarized', 'failed'] as const) {
			expect(canTransitionFile('summarized', to)).toBe(false)
		}
	})

	test('failed can only re-enter at staged (retry), not jump ahead', () => {
		expect(canTransitionFile('failed', 'staged')).toBe(true)
		expect(canTransitionFile('failed', 'uploaded')).toBe(false)
		expect(canTransitionFile('failed', 'summarized')).toBe(false)
	})

	test('assertFileTransition throws on illegal edge with readable message', () => {
		expect(() => assertFileTransition('discovered', 'summarized')).toThrow(/Illegal file transition/)
	})

	test('job transitions: pending must discover before transfer', () => {
		expect(canTransitionJob('pending', 'transferring')).toBe(false)
		expect(canTransitionJob('pending', 'discovering')).toBe(true)
		expect(canTransitionJob('transferring', 'processing')).toBe(true)
		expect(canTransitionJob('processing', 'done')).toBe(true)
		expect(canTransitionJob('done', 'failed')).toBe(false)
	})
})
