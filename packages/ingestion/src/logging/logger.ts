/**
 * Minimal structured logger port. Fields are flat key/value pairs so both
 * human console output and log aggregators stay readable. Implementations
 * must never log document content (OCR text, summaries, bytes) — log
 * lengths, hashes, counts, and ids only.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, string | number | boolean | null | undefined>

export interface Logger {
	debug(message: string, fields?: LogFields): void
	info(message: string, fields?: LogFields): void
	warn(message: string, fields?: LogFields): void
	error(message: string, fields?: LogFields): void
}

function formatFields(fields?: LogFields): string {
	if (!fields) return ''
	const parts: string[] = []
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue
		parts.push(`${key}=${JSON.stringify(value)}`)
	}
	return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

/** Console logger in the repo's `[SCOPE] stage` style. */
export function consoleLogger(scope: string): Logger {
	const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
		const line = `[${scope}] ${message}${formatFields(fields)}`
		if (level === 'error') console.error(line)
		else if (level === 'warn') console.warn(line)
		else console.log(line)
	}
	return {
		debug: (message, fields) => emit('debug', message, fields),
		info: (message, fields) => emit('info', message, fields),
		warn: (message, fields) => emit('warn', message, fields),
		error: (message, fields) => emit('error', message, fields),
	}
}

/** No-op logger for tests and quiet contexts. */
export function silentLogger(): Logger {
	const noop = (_message: string, _fields?: LogFields): void => {}
	return { debug: noop, info: noop, warn: noop, error: noop }
}

/** In-memory logger for asserting log behavior in tests. */
export function memoryLogger(): Logger & { entries: Array<{ level: LogLevel; message: string; fields?: LogFields }> } {
	const entries: Array<{ level: LogLevel; message: string; fields?: LogFields }> = []
	const push = (level: LogLevel) => (message: string, fields?: LogFields): void => {
		if (fields === undefined) entries.push({ level, message })
		else entries.push({ level, message, fields })
	}
	return {
		entries,
		debug: push('debug'),
		info: push('info'),
		warn: push('warn'),
		error: push('error'),
	}
}
