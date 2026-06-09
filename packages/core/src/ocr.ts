import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer";
import { DocumentRepository } from "@workspace/shared";
import { z } from "zod";
import { ModelManager } from "./services/ocr";

const AzureConfigSchema = z.object({
	endpoint: z.string().url(),
	key: z.string().min(1),
});

export interface OCRResult {
	id: string;
	content: string;
	confidence: number;
	structuredData?: Record<string, any>;
	extractedFields?: Record<string, any>;
}

export class AzureOCRService {
	private client: DocumentAnalysisClient;
	private docRepo: DocumentRepository;

	constructor() {
		const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
		const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

		if (!endpoint || !key) {
			throw new Error("Azure Document Intelligence credentials not configured");
		}

		const config = AzureConfigSchema.parse({ endpoint, key });
		this.client = new DocumentAnalysisClient(config.endpoint, new AzureKeyCredential(config.key));
		this.docRepo = new DocumentRepository();
	}

	async processDocumentFromBuffer(documentId: number, fileBuffer: Buffer): Promise<OCRResult> {
		try {
			// Analyze document
			let modelId = ModelManager.getModelForDocumentType("default");
			const poller = await this.client.beginAnalyzeDocument(modelId, fileBuffer);
			const result = await poller.pollUntilDone();

			// Extract content
			const content = result.content || "";
			const confidence = result.documents?.[0]?.confidence || 0;

			// Extract structured data
			const structuredData: Record<string, any> = result.documents?.[0]?.structuredData || {};
			const extractedFields: Record<string, any> = {};

			if (result.keyValuePairs) {
				for (const kvp of result.keyValuePairs) {
					if (kvp.key?.content && kvp.value?.content) {
						extractedFields[kvp.key.content] = kvp.value.content;
					}
				}
			}

			console.log("OCR completed =======", {
				id: documentId.toString(),
				content,
				confidence,
				structuredData,
				extractedFields,

			});
			// Update document in database
			await this.docRepo.updateStatus(documentId, "completed", undefined);
			return {
				id: documentId.toString(),
				content,
				confidence,
				structuredData,
				extractedFields,
			};
		} catch (error) {
			console.error("OCR processing failed:", error);
			await this.docRepo.updateStatus(documentId, "failed", error instanceof Error ? error.message : "Unknown error");
			throw error;
		}
	}

	async processDocumentById(documentId: number): Promise<OCRResult> {
		const document = await this.docRepo.findById(documentId);
		if (!document) {
			throw new Error(`Document ${documentId} not found`);
		}

		// For now, assume file is stored temporarily

		// Update status to processing
		await this.docRepo.updateStatus(documentId, "processing");

		return this.processDocumentFromBuffer(documentId, document.fullContent);
	}
}

// Singleton instance
let azureOcrServiceInstance: AzureOCRService | null = null;

export function getAzureOCRService(): AzureOCRService {
	if (!azureOcrServiceInstance) {
		azureOcrServiceInstance = new AzureOCRService();
	}
	return azureOcrServiceInstance;
}
