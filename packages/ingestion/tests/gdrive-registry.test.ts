import { describe, expect, test } from 'bun:test'
import { GDriveConnector, GDriveNotImplementedError } from '../src/connectors/gdrive'
import { createConnector } from '../src/connectors/registry'

describe('connectors/gdrive + registry — stub honesty', () => {
	test('gdrive listFiles throws typed NotImplemented (not a silent empty)', async () => {
		const connector = new GDriveConnector()
		let error: unknown = null
		try {
			for await (const _f of connector.listFiles({ root: 'folder-id' })) {
				// noop
			}
		} catch (e) {
			error = e
		}
		expect(error).toBeInstanceOf(GDriveNotImplementedError)
		expect((error as GDriveNotImplementedError).method).toBe('listFiles')
	})

	test('gdrive openRead throws typed error synchronously', () => {
		const connector = new GDriveConnector()
		expect(() => connector.openRead({ sourceKey: 'x', sizeBytes: 1 })).toThrow(GDriveNotImplementedError)
	})

	test('registry maps kinds without conditionals at call sites', () => {
		expect(createConnector('local-fs', '/tmp').kind).toBe('local-fs')
		expect(createConnector('gdrive', 'folder').kind).toBe('gdrive')
	})

	test('registry s3 without client throws (catches missing-creds silent undefined)', () => {
		expect(() => createConnector('s3', 's3://b/p')).toThrow(/s3Client/)
	})
})
