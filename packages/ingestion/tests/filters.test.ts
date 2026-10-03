import { describe, expect, test } from 'bun:test'
import {
	isAllowedExtension,
	isPathSafe,
	depthOf,
	isDepthAllowed,
	shouldIgnoreDir,
	shouldIndexFile,
} from '../src/walk/filters'

describe('walk/filters — path safety (traversal escape bugs)', () => {
	test.each([
		['../evil.pdf', false],
		['a/../../evil.pdf', false],
		['/absolute/path.pdf', false],
		['C:\\windows\\evil.pdf', false],
		['', false],
		['a//b.pdf', false],
		['ok/case.pdf', true],
		['cases/2024/smith/pleading.pdf', true],
	])('isPathSafe(%p) === %p', (input, expected) => {
		expect(isPathSafe(input)).toBe(expected)
	})

	test('backslash segments are normalized before .. check', () => {
		expect(isPathSafe('a\\..\\evil.pdf')).toBe(false)
	})

	test('depth counts path segments, not characters', () => {
		expect(depthOf('a/b/c.pdf')).toBe(3)
		expect(isDepthAllowed('a/b/c.pdf', 3)).toBe(true)
		expect(isDepthAllowed('a/b/c/d.pdf', 3)).toBe(false)
	})

	test('extension check is case-insensitive (catches .PDF skip bug)', () => {
		expect(isAllowedExtension('PLEADING.PDF')).toBe(true)
		expect(isAllowedExtension('scan.TIFF')).toBe(true)
		expect(isAllowedExtension('notes.txt')).toBe(false)
		expect(isAllowedExtension('noext')).toBe(false)
	})

	test('ignore dirs catch node_modules/.git walk explosion', () => {
		expect(shouldIgnoreDir('node_modules')).toBe(true)
		expect(shouldIgnoreDir('.git')).toBe(true)
		expect(shouldIgnoreDir('cases')).toBe(false)
	})

	test('shouldIndexFile rejects oversize, unsafe, and ignored-dir files', () => {
		expect(
			shouldIndexFile({ filename: 'a.pdf', relativePath: '../a.pdf', sizeBytes: 10 }),
		).toBe(false)
		expect(
			shouldIndexFile({ filename: 'a.pdf', relativePath: 'ok/a.pdf', sizeBytes: 10 }, { maxBytes: 5 }),
		).toBe(false)
		expect(
			shouldIndexFile({ filename: 'a.pdf', relativePath: 'node_modules/a.pdf', sizeBytes: 10 }),
		).toBe(false)
		expect(
			shouldIndexFile({ filename: 'a.txt', relativePath: 'ok/a.txt', sizeBytes: 10 }),
		).toBe(false)
		expect(
			shouldIndexFile({ filename: 'a.pdf', relativePath: 'ok/a.pdf', sizeBytes: 10 }),
		).toBe(true)
	})
})
