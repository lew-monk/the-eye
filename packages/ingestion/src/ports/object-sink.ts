/** Narrow put-with-progress seam over object storage. */

export interface PutWithProgressOptions {
	key: string
	contentType: string
	expectedBytes: number
	onChunk?: (transferredBytes: number) => void
}

export interface ObjectSink {
	putObject(options: PutWithProgressOptions, body: AsyncIterable<Uint8Array>): Promise<void>
}
