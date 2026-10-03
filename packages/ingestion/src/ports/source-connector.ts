/** Source connector port — discovery + byte access for one ingestion source. */

export type SourceKind = 'local-fs' | 's3' | 'gdrive'

export interface SourceFile {
	/** Opaque key in the source system (absolute path, s3 key, drive id). */
	sourceKey: string
	/** POSIX-normalized path relative to the job root, e.g. `cases/2024/smith/pleading.pdf`. */
	relativePath: string
	filename: string
	sizeBytes: number
	mtimeMs: number | null
	checksum: string | null
}

export interface SourceListOptions {
	/** Root of the job: local dir, `s3://bucket/prefix`, or drive folder id. */
	root: string
	maxDepth?: number
}

export interface SourceConnector {
	readonly kind: SourceKind
	listFiles(options: SourceListOptions): AsyncIterable<SourceFile>
	openRead(handle: Pick<SourceFile, 'sourceKey' | 'sizeBytes'>): AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>
}
