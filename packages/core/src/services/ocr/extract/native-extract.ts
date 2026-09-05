import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { NativePage } from './hybrid-merge'

export interface NativeExtractResult {
	extractor: string
	pageCount: number
	pages: NativePage[]
}

function defaultScriptPath(): string {
	if (process.env.PDF_EXTRACT_SCRIPT) return process.env.PDF_EXTRACT_SCRIPT
	const candidates = [
		join(process.cwd(), 'packages/coreference-worker/src/pdf_extract.py'),
		join(process.cwd(), '../coreference-worker/src/pdf_extract.py'),
		join(import.meta.dir, '../../../../../../coreference-worker/src/pdf_extract.py'),
	]
	return candidates.find((p) => existsSync(p)) ?? candidates[0]!
}

export function resolvePdfExtractCommand(): { cmd: string; args: string[] } {
	const cmd = process.env.PDF_EXTRACT_PYTHON || 'python3'
	return { cmd, args: [defaultScriptPath()] }
}

export async function runNativeExtract(fileBuffer: Buffer, timeoutMs = 120_000): Promise<NativeExtractResult> {
	const { cmd, args } = resolvePdfExtractCommand()
	const dir = await mkdtemp(join(tmpdir(), 'eye-pdf-'))
	const pdfPath = join(dir, 'input.pdf')
	await writeFile(pdfPath, fileBuffer)

	try {
		const stdout = await spawnPython([...args, pdfPath], cmd, timeoutMs)
		const parsed = JSON.parse(stdout) as NativeExtractResult
		if (!parsed || !Array.isArray(parsed.pages)) {
			throw new Error('pdf_extract.py returned invalid JSON (missing pages)')
		}
		return parsed
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

function spawnPython(args: string[], cmd: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
		let out = ''
		let err = ''
		const timer = setTimeout(() => {
			child.kill('SIGKILL')
			reject(new Error(`pdf extract timed out after ${timeoutMs}ms`))
		}, timeoutMs)

		child.stdout.on('data', (c: Buffer) => {
			out += c.toString()
		})
		child.stderr.on('data', (c: Buffer) => {
			err += c.toString()
		})
		child.on('error', (e) => {
			clearTimeout(timer)
			reject(e)
		})
		child.on('close', (code) => {
			clearTimeout(timer)
			if (code !== 0) {
				reject(new Error(`pdf_extract.py exited ${code}: ${err || out}`))
				return
			}
			resolve(out)
		})
	})
}
