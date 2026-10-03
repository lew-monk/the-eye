import { Readable } from 'node:stream'
import { getObjectStorage, isObjectStorageConfigured, type ObjectStorage } from '@workspace/core'
import type { ObjectSink } from '@workspace/ingestion'

async function collectStream(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
	const parts: Uint8Array[] = []
	for await (const chunk of stream) parts.push(chunk)
	const total = parts.reduce((n, p) => n + p.length, 0)
	const out = new Uint8Array(total)
	let off = 0
	for (const p of parts) {
		out.set(p, off)
		off += p.length
	}
	return out
}

/** Durable ObjectSink over the shared S3/MinIO object storage. */
export class S3ObjectSink implements ObjectSink {
	constructor(private readonly storage: ObjectStorage = getObjectStorage()) {}

	async putObject(
		options: { key: string; contentType: string; expectedBytes: number },
		body: AsyncIterable<Uint8Array>,
	): Promise<void> {
		const bytes = await collectStream(body)
		if (bytes.length !== options.expectedBytes) {
			throw new Error(
				`Size mismatch for ${options.key}: expected ${options.expectedBytes}, got ${bytes.length}`,
			)
		}
		await this.storage.putObject(options.key, Buffer.from(bytes), options.contentType)
	}
}

/** Read bytes back from shared object storage (worker path). */
export async function getStorageBytes(storage: ObjectStorage, key: string): Promise<Uint8Array> {
	const object = await storage.getObject(key)
	if (Buffer.isBuffer(object.body)) return new Uint8Array(object.body)
	if (object.body instanceof Uint8Array) return object.body
	const stream = object.body as unknown as Readable
	const parts: Buffer[] = []
	for await (const chunk of stream) {
		parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
	}
	return new Uint8Array(Buffer.concat(parts))
}

/** S3/MinIO sink when configured, otherwise the in-memory sink (tests, dev without storage). */
export function isDurableSinkConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	return isObjectStorageConfigured(env)
}
