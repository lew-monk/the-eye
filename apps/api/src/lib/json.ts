export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]

export function asJsonValue(value: JsonValue | object | null | undefined): JsonValue | null {
	if (value == null) return null
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value
	}
	if (typeof value === 'object') return value as JsonValue
	return null
}

export function jsonObjectContent(value: JsonValue | object | null | undefined): string {
	const json = asJsonValue(value)
	if (!json || typeof json !== 'object' || Array.isArray(json)) return ''
	const content = json.content
	return typeof content === 'string' ? content : ''
}
