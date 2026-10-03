import { describe, expect, test } from 'bun:test'
import { workerCollections } from './worker'

describe('ingestion worker — collection subscription parsing', () => {
	test('defaults to judgments when unset', () => {
		expect(workerCollections({} as NodeJS.ProcessEnv)).toEqual(['judgments'])
	})

	test('parses comma-separated collections, trims and lowercases', () => {
		expect(workerCollections({ INGEST_COLLECTIONS: 'Judgments, Contracts , police-reports' } as NodeJS.ProcessEnv)).toEqual([
			'judgments',
			'contracts',
			'police-reports',
		])
	})

	test('blank entries are dropped, empty falls back to default', () => {
		expect(workerCollections({ INGEST_COLLECTIONS: ' , ,' } as NodeJS.ProcessEnv)).toEqual(['judgments'])
		expect(workerCollections({ INGEST_COLLECTIONS: '' } as NodeJS.ProcessEnv)).toEqual(['judgments'])
	})
})
