import {
	AzureKeyCredential,
	DocumentAnalysisClient,
	AnalyzeResult,
} from '@azure/ai-form-recognizer'
import { getAzureConfig } from '../../config/azure'
import { withRetry } from '../../utils/retry'

export class AzureDocumentIntelligenceClient {
	private client: DocumentAnalysisClient

	constructor() {
		const config = getAzureConfig()
		const credential = new AzureKeyCredential(config.apiKey)
		this.client = new DocumentAnalysisClient(config.endpoint, credential)
	}

	async analyzeDocument(
		fileBuffer: Buffer,
		modelId: string = 'prebuilt-contract'
	): Promise<AnalyzeResult> {
		return withRetry(async () => {
			const poller = await this.client.beginAnalyzeDocument(modelId, fileBuffer)
			return await poller.pollUntilDone()
		}, {
			retries: 3,
			minTimeout: 2000,
			maxTimeout: 30000
		})
	}

	async analyzeNameEntityRecognition(
		fileBuffer: Buffer,
		modelId: string = 'prebuilt-document'
	): Promise<AnalyzeResult> {
		return withRetry(async () => {
			const poller = await this.client.beginAnalyzeDocument(modelId, fileBuffer)
			return await poller.pollUntilDone()
		}, {
			retries: 3,
			minTimeout: 2000,
			maxTimeout: 30000
		})
	}

	async analyzeDocumentFromUrl(
		documentUrl: string,
		modelId: string = 'prebuilt-document'
	): Promise<AnalyzeResult> {
		return withRetry(async () => {
			const poller = await this.client.beginAnalyzeDocumentFromUrl(modelId, documentUrl)
			return await poller.pollUntilDone()
		}, {
			retries: 3,
			minTimeout: 2000,
			maxTimeout: 30000
		})
	}
}
