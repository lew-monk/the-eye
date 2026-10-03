import { describe, expect, test } from 'bun:test'
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { S3Connector, parseS3Root } from '../src/connectors/s3'
import { discoverFiles } from '../src/walk/walker'

function fakeS3(pages: Array<{ keys: string[]; next?: string }>) {
	let calls = 0
	return {
		calls: () => calls,
		client: {
			send: async (cmd: unknown) => {
				if (cmd instanceof ListObjectsV2Command) {
					const token = (cmd.input.ContinuationToken as string | undefined) ?? ''
					const idx = token ? Number(token) : 0
					calls += 1
					const page = pages[idx]
					if (!page) throw new Error('bad page token')
					return {
						Contents: page.keys.map((Key) => ({ Key, Size: 10, LastModified: new Date(0) })),
						IsTruncated: idx < pages.length - 1,
						NextContinuationToken: idx < pages.length - 1 ? String(idx + 1) : undefined,
					}
				}
				if (cmd instanceof GetObjectCommand) {
					const body = (async function* () {
						yield new TextEncoder().encode('hello')
					})()
					return { Body: body }
				}
				throw new Error('unexpected command')
			},
		},
	}
}

describe('connectors/s3 — pagination + prefix contract', () => {
	test('parseS3Root handles s3:// and bare forms', () => {
		expect(parseS3Root('s3://bucket/prefix/a')).toEqual({ bucket: 'bucket', prefix: 'prefix/a' })
		expect(parseS3Root('bucket/prefix')).toEqual({ bucket: 'bucket', prefix: 'prefix' })
		expect(parseS3Root('bucket')).toEqual({ bucket: 'bucket', prefix: '' })
	})

	test('paginated listing concatenates all pages (catches first-page-only bug)', async () => {
		const { client, calls } = fakeS3([
			{ keys: ['docs/a.pdf'] },
			{ keys: ['docs/b.pdf'] },
			{ keys: ['docs/sub/c.pdf'] },
		])
		const connector = new S3Connector({ bucket: 'bucket', prefix: 'docs', client: client as never })
		const seen: string[] = []
		for await (const f of discoverFiles(connector, { root: 's3://bucket/docs' })) {
			seen.push(f.relativePath)
		}
		expect(calls()).toBe(3)
		expect(seen.sort()).toEqual(['a.pdf', 'b.pdf', 'sub/c.pdf'])
	})

	test('prefix is stripped exactly (catches off-by-one stripping docs/ vs docs)', async () => {
		const { client } = fakeS3([{ keys: ['docs/a.pdf', 'docs/sub/b.pdf'] }])
		const connector = new S3Connector({ bucket: 'bucket', prefix: 'docs', client: client as never })
		const seen: string[] = []
		for await (const f of discoverFiles(connector, { root: 's3://bucket/docs' })) {
			seen.push(f.relativePath)
		}
		expect(seen).not.toContain('docs/a.pdf')
		expect(seen).toContain('a.pdf')
		expect(seen).toContain('sub/b.pdf')
	})

	test('directory placeholder keys (trailing /) are skipped', async () => {
		const { client } = fakeS3([{ keys: ['docs/', 'docs/a.pdf'] }])
		const connector = new S3Connector({ bucket: 'bucket', prefix: 'docs', client: client as never })
		const seen: string[] = []
		for await (const f of connector.listFiles({ root: 's3://bucket/docs' })) {
			seen.push(f.relativePath)
		}
		expect(seen).toEqual(['a.pdf'])
	})

	test('openRead with malformed sourceKey throws (catches key-format drift)', async () => {
		const { client } = fakeS3([{ keys: [] }])
		const connector = new S3Connector({ bucket: 'b', prefix: '', client: client as never })
		await expect(connector.openRead({ sourceKey: 'not-a-url', sizeBytes: 1 })).rejects.toThrow()
	})
})
