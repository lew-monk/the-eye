import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { isPathSafe } from '../walk/filters'

export function shortChecksum(checksum: string, length = 8): string {
	return checksum.slice(0, length).toLowerCase()
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

export interface JudgmentKeyParams {
	source: string
	jobId: string
	relativePath: string
	checksum: string
	/** Storage collection prefix. Defaults to 'judgments'. */
	collection?: string
}

/**
 * Hierarchy-preserving key:
 * `<collection>/<source>/<jobId>/<relative/dir>/<basename>-<shortchecksum>.<ext>`
 * Same basename in two folders disambiguates via dir + checksum suffix;
 * keys are content-stable for resume.
 */
export function buildCollectionStorageKey(params: JudgmentKeyParams & { collection: string }): string {
	const collection = params.collection
	if (!/^[a-z0-9-]{1,64}$/i.test(collection)) {
		throw new Error(`Invalid collection segment: ${collection}`)
	}
	if (!isPathSafe(params.relativePath)) {
		throw new Error(`Unsafe relativePath: ${params.relativePath}`)
	}
	if (!/^[a-z0-9-]+$/i.test(params.source)) {
		throw new Error(`Invalid source segment: ${params.source}`)
	}
	if (!params.checksum || params.checksum.length < 8) {
		throw new Error('Checksum too short for storage key')
	}
	const normalized = params.relativePath.replace(/\\/g, '/')
	const segments = normalized.split('/')
	const basename = segments[segments.length - 1] as string
	const dir = segments.slice(0, -1).join('/')
	const dot = basename.lastIndexOf('.')
	const stem = (dot > 0 ? basename.slice(0, dot) : basename).replace(/[^a-zA-Z0-9._-]+/g, '_')
	const ext = extname(basename).toLowerCase()
	const suffix = shortChecksum(params.checksum)
	const file = `${stem}-${suffix}${ext}`
	const prefix = `${collection}/${params.source}/${params.jobId}`
	return dir ? `${prefix}/${dir}/${file}` : `${prefix}/${file}`
}

/** Backward-compatible wrapper: judgments collection. */
export function buildJudgmentStorageKey(params: JudgmentKeyParams): string {
	return buildCollectionStorageKey({ collection: 'judgments', ...params })
}
