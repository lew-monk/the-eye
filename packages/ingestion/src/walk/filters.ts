export const MAX_WALK_DEPTH = 32

const DEFAULT_ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp'])
const DEFAULT_IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__', '.DS_Store'])

export interface FilterOptions {
	allowedExtensions?: ReadonlySet<string>
	maxBytes?: number
	ignoreDirs?: ReadonlySet<string>
	maxDepth?: number
}

export function getExtension(filename: string): string {
	const idx = filename.lastIndexOf('.')
	if (idx < 0) return ''
	return filename.slice(idx + 1).toLowerCase()
}

export function isAllowedExtension(filename: string, allowed: ReadonlySet<string> = DEFAULT_ALLOWED_EXTENSIONS): boolean {
	return allowed.has(getExtension(filename))
}

/** Reject paths that escape the job root: absolute, `..` segments, empty, backslashes-as-escape. */
export function isPathSafe(relativePath: string): boolean {
	if (!relativePath || relativePath.length === 0) return false
	if (relativePath.startsWith('/') || relativePath.startsWith('\\')) return false
	// Windows drive letter `C:\...` or `C:/...`
	if (/^[A-Za-z]:[\\/]/.test(relativePath)) return false
	const normalized = relativePath.replace(/\\/g, '/')
	if (normalized.includes('\0')) return false
	const segments = normalized.split('/')
	for (const seg of segments) {
		if (seg === '..') return false
		if (seg.length === 0) return false
	}
	return true
}

export function depthOf(relativePath: string): number {
	return relativePath.replace(/\\/g, '/').split('/').filter(Boolean).length
}

export function isDepthAllowed(relativePath: string, maxDepth: number = MAX_WALK_DEPTH): boolean {
	return depthOf(relativePath) <= maxDepth
}

export function shouldIgnoreDir(dirname: string, ignore: ReadonlySet<string> = DEFAULT_IGNORE_DIRS): boolean {
	return ignore.has(dirname)
}

export function shouldIndexFile(
	file: { filename: string; relativePath: string; sizeBytes: number },
	options: FilterOptions = {},
): boolean {
	if (!isPathSafe(file.relativePath)) return false
	if (!isAllowedExtension(file.filename, options.allowedExtensions)) return false
	if (options.maxBytes !== undefined && file.sizeBytes > options.maxBytes) return false
	if (!isDepthAllowed(file.relativePath, options.maxDepth ?? MAX_WALK_DEPTH)) return false
	const segments = file.relativePath.replace(/\\/g, '/').split('/').slice(0, -1)
	const ignore = options.ignoreDirs ?? DEFAULT_IGNORE_DIRS
	for (const seg of segments) {
		if (shouldIgnoreDir(seg, ignore)) return false
	}
	return true
}
