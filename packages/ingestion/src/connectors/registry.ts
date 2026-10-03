import type { SourceConnector, SourceKind } from '../ports/source-connector'
import { LocalFsConnector } from './local-fs'
import { S3Connector, parseS3Root } from './s3'
import { GDriveConnector } from './gdrive'
import type { S3Client } from '@aws-sdk/client-s3'

export interface ConnectorDeps {
	s3Client?: Pick<S3Client, 'send'>
}

/** Pure source-kind → factory map (no conditionals sprawl at call sites). */
export function createConnector(kind: SourceKind, root: string, deps: ConnectorDeps = {}): SourceConnector {
	const factories: Record<SourceKind, () => SourceConnector> = {
		'local-fs': () => new LocalFsConnector(),
		s3: () => {
			if (!deps.s3Client) throw new Error('S3 connector requires s3Client')
			const parsed = parseS3Root(root)
			return new S3Connector({ bucket: parsed.bucket, prefix: parsed.prefix, client: deps.s3Client })
		},
		gdrive: () => new GDriveConnector(),
	}
	return factories[kind]()
}
