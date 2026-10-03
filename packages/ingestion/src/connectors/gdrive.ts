import type { SourceConnector, SourceFile } from '../ports/source-connector'

export class GDriveNotImplementedError extends Error {
	readonly method: string
	constructor(method: string) {
		super(`GDrive connector not implemented: ${method}`)
		this.name = 'GDriveNotImplementedError'
		this.method = method
	}
}

/** Typed stub: implements the port, throws NotImplemented. Fake in tests. */
export class GDriveConnector implements SourceConnector {
	readonly kind = 'gdrive' as const

	async *listFiles(_options: { root: string }): AsyncGenerator<SourceFile, void, void> {
		throw new GDriveNotImplementedError('listFiles')
	}

	openRead(_handle: { sourceKey: string; sizeBytes: number }): Promise<AsyncIterable<Uint8Array>> {
		throw new GDriveNotImplementedError('openRead')
	}
}
