import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, basename } from 'node:path'
import type { SourceConnector, SourceFile } from '../ports/source-connector'
import { shouldIgnoreDir } from '../walk/filters'

function toPosix(p: string): string {
	return p.split('\\').join('/')
}

async function checksumFile(path: string): Promise<string | null> {
	try {
		const file = Bun.file(path)
		const bytes = await file.arrayBuffer()
		return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
	} catch {
		return null
	}
}

/**
 * Recursive local-fs walk. Directory symlinks are NOT followed
 * (recorded and skipped — avoids cycles). Recursion via explicit
 * stack so max depth aborts with a typed error instead of recursing forever.
 */
export class LocalFsConnector implements SourceConnector {
	readonly kind = 'local-fs' as const

	async *listFiles(options: { root: string; maxDepth?: number }): AsyncGenerator<SourceFile, void, void> {
		const maxDepth = options.maxDepth ?? 32
		const root = options.root
		const rootStat = await stat(root).catch(() => null)
		if (!rootStat || !rootStat.isDirectory()) {
			throw new Error(`Local root is not a directory: ${root}`)
		}
		const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
		while (stack.length > 0) {
			const current = stack.pop() as { dir: string; depth: number }
			if (current.depth > maxDepth) {
				throw new Error(`Walk exceeded max depth ${maxDepth}`)
			}
			let entries: import('node:fs').Dirent[]
			try {
				entries = (await readdir(current.dir, { withFileTypes: true })) as import('node:fs').Dirent[]
			} catch {
				continue
			}
			for (const entry of entries) {
				const abs = join(current.dir, entry.name)
				if (entry.isSymbolicLink()) {
					// Never follow symlinks (file or dir) — avoids cycles.
					continue
				}
				if (entry.isDirectory()) {
					if (shouldIgnoreDir(entry.name)) continue
					stack.push({ dir: abs, depth: current.depth + 1 })
				} else if (entry.isFile()) {
					const st = await stat(abs).catch(() => null)
					if (!st) continue
					const rel = toPosix(relative(root, abs))
					yield {
						sourceKey: abs,
						relativePath: rel,
						filename: basename(abs),
						sizeBytes: st.size,
						mtimeMs: st.mtimeMs,
						checksum: null,
					}
				}
			}
		}
	}

	async openRead(handle: Pick<SourceFile, 'sourceKey' | 'sizeBytes'>): Promise<AsyncIterable<Uint8Array>> {
		const path = handle.sourceKey
		async function* gen(): AsyncGenerator<Uint8Array, void, void> {
			const file = Bun.file(path)
			const buf = new Uint8Array(await file.arrayBuffer())
			const CHUNK = 64 * 1024
			for (let i = 0; i < buf.length; i += CHUNK) {
				yield buf.slice(i, i + CHUNK)
			}
		}
		return gen()
	}
}

export { checksumFile }
