import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalFsConnector } from '../src/connectors/local-fs'
import { discoverFiles } from '../src/walk/walker'

let root: string

async function buildFixtureTree(base: string): Promise<void> {
	await mkdir(join(base, 'cases/2024/smith'), { recursive: true })
	await mkdir(join(base, 'cases/2024/jones'), { recursive: true })
	await mkdir(join(base, 'empty-dir'), { recursive: true })
	await writeFile(join(base, 'cases/2024/smith/pleading.pdf'), 'pleading-smith')
	await writeFile(join(base, 'cases/2024/jones/pleading.pdf'), 'pleading-jones')
	await writeFile(join(base, 'cases/2024/top.pdf'), 'top')
	await writeFile(join(base, 'node_modules/skip.pdf'), 'x').catch(async () => {
		await mkdir(join(base, 'node_modules'), { recursive: true })
		await writeFile(join(base, 'node_modules/skip.pdf'), 'x')
	})
	// Symlink loop: loopdir/link -> root (must be skipped, never followed)
	await mkdir(join(base, 'loopdir'), { recursive: true })
	await symlink(base, join(base, 'loopdir', 'link')).catch(() => {})
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'ingest-local-'))
	await buildFixtureTree(root)
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe('connectors/local-fs — nested-tree contract', () => {
	test('discovers nested files with POSIX relativePaths, skips ignored dirs', async () => {
		const connector = new LocalFsConnector()
		const seen: string[] = []
		for await (const f of discoverFiles(connector, { root })) {
			seen.push(f.relativePath)
		}
		expect(seen).toContain('cases/2024/smith/pleading.pdf')
		expect(seen).toContain('cases/2024/jones/pleading.pdf')
		expect(seen).toContain('cases/2024/top.pdf')
		// ignored dir must not leak in
		expect(seen.some((p) => p.startsWith('node_modules/'))).toBe(false)
	})

	test('same basename in two folders yields distinct sourceKeys', async () => {
		const connector = new LocalFsConnector()
		const keys = new Map<string, string>()
		for await (const f of discoverFiles(connector, { root })) {
			if (f.filename === 'pleading.pdf') keys.set(f.relativePath, f.sourceKey)
		}
		expect(keys.size).toBe(2)
		const values = [...keys.values()]
		expect(values[0]).not.toBe(values[1])
	})

	test('symlink loop does not hang or duplicate (terminates)', async () => {
		const connector = new LocalFsConnector()
		const seen: string[] = []
		for await (const f of discoverFiles(connector, { root })) {
			seen.push(f.relativePath)
		}
		expect(seen.some((p) => p.includes('loopdir/link'))).toBe(false)
		expect(seen.length).toBeLessThan(20)
	})

	test('empty directories create no rows', async () => {
		const connector = new LocalFsConnector()
		const seen: string[] = []
		for await (const f of discoverFiles(connector, { root })) {
			seen.push(f.relativePath)
		}
		expect(seen.some((p) => p === 'empty-dir' || p.startsWith('empty-dir/'))).toBe(false)
	})

	test('non-directory root throws (catches file-as-root misconfig)', async () => {
		const connector = new LocalFsConnector()
		const fileRoot = join(root, 'cases/2024/top.pdf')
		let threw = false
		try {
			for await (const _f of discoverFiles(connector, { root: fileRoot })) {
				// noop
			}
		} catch {
			threw = true
		}
		expect(threw).toBe(true)
	})

	test('openRead streams bytes back losslessly', async () => {
		const connector = new LocalFsConnector()
		for await (const f of connector.listFiles({ root })) {
			if (f.relativePath === 'cases/2024/top.pdf') {
				const stream = await connector.openRead({ sourceKey: f.sourceKey, sizeBytes: f.sizeBytes })
				const parts: Uint8Array[] = []
				for await (const c of stream as AsyncIterable<Uint8Array>) parts.push(c)
				const text = Buffer.concat(parts).toString('utf8')
				expect(text).toBe('top')
				return
			}
		}
		throw new Error('fixture file missing')
	})
})
