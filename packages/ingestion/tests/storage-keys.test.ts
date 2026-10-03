import { describe, expect, test } from 'bun:test'
import { buildCollectionStorageKey, buildJudgmentStorageKey } from '../src/storage/keys'

describe('storage/keys — hierarchy-preserving judgment keys', () => {
	const checksum = 'abcdef1234567890abcdef1234567890'

	test('mirrors nested dirs so hierarchy survives the round trip', () => {
		const key = buildJudgmentStorageKey({
			source: 'local',
			jobId: 'job1',
			relativePath: 'cases/2024/smith/pleading.pdf',
			checksum,
		})
		expect(key).toBe(`judgments/local/job1/cases/2024/smith/pleading-${checksum.slice(0, 8)}.pdf`)
	})

	test('same basename in two folders disambiguates (no silent overwrite)', () => {
		const a = buildJudgmentStorageKey({ source: 'local', jobId: 'j', relativePath: 'a/contract.pdf', checksum: 'a'.repeat(32) })
		const b = buildJudgmentStorageKey({ source: 'local', jobId: 'j', relativePath: 'b/contract.pdf', checksum: 'b'.repeat(32) })
		expect(a).not.toBe(b)
		expect(a).toContain('/a/contract-')
		expect(b).toContain('/b/contract-')
	})

	test('top-level file has no empty dir segment (no double slash)', () => {
		const key = buildJudgmentStorageKey({ source: 's3', jobId: 'j', relativePath: 'top.pdf', checksum })
		expect(key).toBe(`judgments/s3/j/top-${checksum.slice(0, 8)}.pdf`)
		expect(key).not.toContain('//')
	})

	test('extension is lowercased (catches .PDF vs .pdf key-split bug)', () => {
		const key = buildJudgmentStorageKey({ source: 'local', jobId: 'j', relativePath: 'dir/SCAN.PDF', checksum })
		expect(key.endsWith('.pdf')).toBe(true)
	})

	test.each([
		['../escape.pdf', 'traversal escapes root'],
		['/abs.pdf', 'absolute path'],
	])('rejects unsafe relativePath %p', (relativePath) => {
		expect(() => buildJudgmentStorageKey({ source: 'local', jobId: 'j', relativePath, checksum })).toThrow()
	})

	test('rejects short checksum (would collide on 8-char suffix)', () => {
		expect(() => buildJudgmentStorageKey({ source: 'local', jobId: 'j', relativePath: 'a.pdf', checksum: 'abc' })).toThrow()
	})

	test('wrapper equals collection builder with judgments (back-compat)', () => {
		const params = { source: 'local', jobId: 'j', relativePath: 'a/b.pdf', checksum: 'c'.repeat(32) }
		expect(buildJudgmentStorageKey(params)).toBe(
			buildCollectionStorageKey({ collection: 'judgments', ...params }),
		)
	})

	test('custom collection prefixes keys (no cross-collection overwrite)', () => {
		const params = { source: 'local', jobId: 'j', relativePath: 'a/b.pdf', checksum: 'c'.repeat(32) }
		const custom = buildCollectionStorageKey({ collection: 'contracts', ...params })
		expect(custom.startsWith('contracts/local/j/')).toBe(true)
		expect(custom).not.toBe(buildJudgmentStorageKey(params))
	})

	test('rejects unsafe collection segments', () => {
		const params = { source: 'local', jobId: 'j', relativePath: 'a.pdf', checksum: 'c'.repeat(32) }
		for (const collection of ['../evil', 'a/b', '', 'x'.repeat(65)]) {
			expect(() => buildCollectionStorageKey({ collection, ...params })).toThrow()
		}
	})
})
