import type { SourceConnector, SourceFile, SourceListOptions } from '../ports/source-connector'
import { MAX_WALK_DEPTH, isDepthAllowed, isPathSafe } from './filters'

export class MaxDepthExceededError extends Error {
	readonly depth: number
	constructor(depth: number, maxDepth: number) {
		super(`Walk exceeded max depth ${maxDepth} at depth ${depth}`)
		this.name = 'MaxDepthExceededError'
		this.depth = depth
	}
}

export class UnsafePathError extends Error {
	readonly relativePath: string
	constructor(relativePath: string) {
		super(`Unsafe relativePath escapes job root: ${relativePath}`)
		this.name = 'UnsafePathError'
		this.relativePath = relativePath
	}
}

export interface DiscoverOptions extends SourceListOptions {
	/** Abort discovery after this many files (guard against runaway roots). */
	maxFiles?: number
}

/**
 * Bounded discovery over any connector. Recursion is the default:
 * connectors must already list recursively; the walker enforces the
 * safety rules (no escape, max depth) uniformly so S3/GDrive behave
 * exactly like local disk.
 */
export async function* discoverFiles(
	connector: SourceConnector,
	options: DiscoverOptions,
): AsyncGenerator<SourceFile, void, void> {
	const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH
	const maxFiles = options.maxFiles ?? 50_000
	let yielded = 0
	for await (const file of connector.listFiles(options)) {
		if (!isPathSafe(file.relativePath)) {
			throw new UnsafePathError(file.relativePath)
		}
		if (!isDepthAllowed(file.relativePath, maxDepth)) {
			throw new MaxDepthExceededError(file.relativePath.split('/').length, maxDepth)
		}
		yield file
		yielded += 1
		if (yielded >= maxFiles) return
	}
}
