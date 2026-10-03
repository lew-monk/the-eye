import { ListObjectsV2Command, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import type { SourceConnector, SourceFile } from '../ports/source-connector'

export interface S3ConnectorConfig {
	bucket: string
	prefix?: string
	client: Pick<S3Client, 'send'>
}

export function parseS3Root(root: string): { bucket: string; prefix: string } {
	// Accepts `s3://bucket/prefix` or bare `bucket/prefix`.
	const withoutScheme = root.startsWith('s3://') ? root.slice('s3://'.length) : root
	const slash = withoutScheme.indexOf('/')
	if (slash < 0) return { bucket: withoutScheme, prefix: '' }
	return {
		bucket: withoutScheme.slice(0, slash),
		prefix: withoutScheme.slice(slash + 1).replace(/^\/+/, ''),
	}
}

function stripPrefix(key: string, prefix: string): string {
	if (!prefix) return key
	const clean = prefix.replace(/\/+$/, '')
	if (key === clean) return ''
	if (key.startsWith(`${clean}/`)) return key.slice(clean.length + 1)
	return key
}

/** S3 prefix listing is inherently recursive; pagination is flat. */
export class S3Connector implements SourceConnector {
	readonly kind = 's3' as const
	private bucket: string
	private prefix: string
	private client: Pick<S3Client, 'send'>

	constructor(config: S3ConnectorConfig) {
		this.bucket = config.bucket
		this.prefix = (config.prefix ?? '').replace(/^\/+/, '')
		this.client = config.client
	}

	async *listFiles(options: { root: string }): AsyncGenerator<SourceFile, void, void> {
		const parsed = parseS3Root(options.root)
		const bucket = parsed.bucket || this.bucket
		const prefix = parsed.prefix || this.prefix
		let token: string | undefined
		do {
			const res = (await this.client.send(
				new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
			)) as { Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>; IsTruncated?: boolean; NextContinuationToken?: string }
			for (const obj of res.Contents ?? []) {
				if (!obj.Key || obj.Key.endsWith('/')) continue
				const relativePath = stripPrefix(obj.Key, prefix)
				if (!relativePath) continue
				const filename = relativePath.split('/').pop() as string
				yield {
					sourceKey: `s3://${bucket}/${obj.Key}`,
					relativePath,
					filename,
					sizeBytes: obj.Size ?? 0,
					mtimeMs: obj.LastModified ? obj.LastModified.getTime() : null,
					checksum: null,
				}
			}
			token = res.IsTruncated ? res.NextContinuationToken : undefined
		} while (token)
	}

	async openRead(handle: Pick<SourceFile, 'sourceKey' | 'sizeBytes'>): Promise<AsyncIterable<Uint8Array>> {
		const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(handle.sourceKey)
		if (!match) throw new Error(`Invalid s3 sourceKey: ${handle.sourceKey}`)
		const bucket = match[1] as string
		const key = match[2] as string
		const res = (await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
			Body?: AsyncIterable<Uint8Array>
		}
		if (!res.Body) throw new Error(`Empty S3 object: ${handle.sourceKey}`)
		return res.Body as AsyncIterable<Uint8Array>
	}
}
