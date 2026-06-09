export class InsufficientPermissionsError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'InsufficientPermissionsError'
	}
}
export class InvalidApiKeyError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'InvalidApiKeyError'
	}
}
