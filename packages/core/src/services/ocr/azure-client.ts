import DocumentIntelligence, {
	getLongRunningPoller,
	isUnexpected,
	type DocumentIntelligenceClient,
} from '@azure-rest/ai-document-intelligence'
import { getAzureConfig } from '../../config/azure'
import { withRetry } from '../../utils/retry'
import { getMaxChunkBytes } from './pdf-chunker'

export class AzureDocumentIntelligenceClient {
	private client: DocumentIntelligenceClient
	readonly apiVersion = '2024-11-30'

	constructor() {
		const config = getAzureConfig()
		this.client = DocumentIntelligence(config.endpoint, { key: config.apiKey })
	}

	async analyzeDocument(
		fileBuffer: Buffer,
		modelId: string = 'prebuilt-read',
	): Promise<any> {
		const maxBytes = getMaxChunkBytes()
		if (fileBuffer.byteLength > maxBytes) {
			throw new Error(
				`Document is ${fileBuffer.byteLength} bytes > Azure max chunk ${maxBytes}`,
			)
		}

		return withRetry(async () => {
			const initialResponse = await this.client
				.path('/documentModels/{modelId}:analyze', modelId)
				.post({
					contentType: 'application/octet-stream',
					body: fileBuffer,
				})

			if (isUnexpected(initialResponse)) {
				const err = initialResponse.body as any
				throw new Error(
					err?.error?.innererror?.message ||
						err?.error?.message ||
						`Azure analyze failed: ${initialResponse.status}`,
				)
			}

			const poller = getLongRunningPoller(this.client, initialResponse)
			const result = await poller.pollUntilDone()
			if (isUnexpected(result as any)) {
				const err = (result as any).body
				throw new Error(err?.error?.message || 'Azure analyze poll failed')
			}
			return (result as any).body?.analyzeResult ?? (result as any).body
		}, {
			retries: 3,
			minTimeout: 2000,
			maxTimeout: 30000,
		})
	}

	async analyzeNameEntityRecognition(
		fileBuffer: Buffer,
		modelId: string = 'prebuilt-layout',
	): Promise<any> {
		return this.analyzeDocument(fileBuffer, modelId)
	}

	async analyzeDocumentFromUrl(
		documentUrl: string,
		modelId: string = 'prebuilt-read',
	): Promise<any> {
		return withRetry(async () => {
			const initialResponse = await this.client
				.path('/documentModels/{modelId}:analyze', modelId)
				.post({
					contentType: 'application/json',
					body: { urlSource: documentUrl },
				})

			if (isUnexpected(initialResponse)) {
				const err = initialResponse.body as any
				throw new Error(
					err?.error?.message || `Azure analyze URL failed: ${initialResponse.status}`,
				)
			}

			const poller = getLongRunningPoller(this.client, initialResponse)
			const result = await poller.pollUntilDone()
			if (isUnexpected(result as any)) {
				const err = (result as any).body
				throw new Error(err?.error?.message || 'Azure analyze poll failed')
			}
			return (result as any).body?.analyzeResult ?? (result as any).body
		}, {
			retries: 3,
			minTimeout: 2000,
			maxTimeout: 30000,
		})
	}
}
