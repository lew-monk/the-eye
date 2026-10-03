import { describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { ApiKeyService, hashApiKey } from './api-key-service'

function makeFakes(record: Record<string, unknown> | null, seen: { hash: string | null }) {
	const store = new Map<string, string>()
	const connection = {
		get: async (key: string) => store.get(key) ?? null,
		set: async (key: string, value: string) => {
			store.set(key, value)
		},
		del: async (key: string) => {
			store.delete(key)
		},
	}
	const repository = {
		findByHash: async (keyHash: string) => {
			seen.hash = keyHash
			return record
		},
	}
	return { connection, repository }
}

describe('hashApiKey', () => {
	test('matches sha256(raw) used at creation time', () => {
		const raw = 'test-raw-key-123'
		expect(hashApiKey(raw)).toBe(createHash('sha256').update(raw).digest('hex'))
	})

	test('known vector is stable (idempotent lookups)', () => {
		expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
	})
})

describe('ApiKeyService.getApiKey — raw-vs-hash regression', () => {
	test('looks up the HASH, not the raw key (raw value never matches the hash column)', async () => {
		const raw = 'super-secret-raw-key'
		const expectedHash = createHash('sha256').update(raw).digest('hex')
		const seen: { hash: string | null } = { hash: null }
		const record = { keyHash: expectedHash, permission: [] }
		const { connection, repository } = makeFakes(record, seen)
		const service = new ApiKeyService(repository as never, connection as never)

		const found = await service.getApiKey(raw)

		expect(seen.hash).toBe(expectedHash)
		expect(seen.hash).not.toBe(raw)
		expect(found).toBe(record)
	})

	test('unknown key returns null (no throw on miss)', async () => {
		const seen: { hash: string | null } = { hash: null }
		const { connection, repository } = makeFakes(null, seen)
		const service = new ApiKeyService(repository as never, connection as never)

		await expect(service.getApiKey('nope')).resolves.toBeNull()
	})

	test('redis hit short-circuits the database', async () => {
		const raw = 'cached-key'
		const keyHash = hashApiKey(raw)
		const cached = { keyHash, permission: [] }
		let dbCalls = 0
		const connection = {
			get: async () => JSON.stringify(cached),
			set: async () => {},
			del: async () => {},
		}
		const repository = {
			findByHash: async () => {
				dbCalls += 1
				return null
			},
		}
		const service = new ApiKeyService(repository as never, connection as never)

		const found = await service.getApiKey(raw)
		expect(found).toEqual(cached)
		expect(dbCalls).toBe(0)
	})
})
