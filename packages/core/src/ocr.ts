import DocumentIntelligence, {
	getLongRunningPoller,
	isUnexpected,
	type DocumentIntelligenceClient,
} from "@azure-rest/ai-document-intelligence";
import { DocumentRepository } from "@workspace/shared";
import { z } from "zod";
import { ModelManager } from "./services/ocr/model-manager";
import {
	getMaxChunkBytes,
	getMaxPagesPerChunk,
	getPdfPageCount,
	reassembleOcrResults,
	shouldSplit,
	splitPdfByPages,
	type ChunkOcrResult,
} from "./services/ocr/pdf-chunker";
import { DocumentStatus, PipelineStage, logPipelineStage, pipelineLog } from "./utils/pipeline-log";

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

function isPdfBuffer(buffer: Buffer): boolean {
	return buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF";
}

export class AzureOCRService {
	private client: DocumentIntelligenceClient;
	private docRepo: DocumentRepository;
	/** API version used by @azure-rest/ai-document-intelligence@1.x */
	readonly apiVersion = "2024-11-30";

	constructor() {
		const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
		const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

		if (!endpoint || !key) {
			throw new Error("Azure Document Intelligence credentials not configured");
		}

		const config = AzureConfigSchema.parse({ endpoint, key });
		this.client = DocumentIntelligence(config.endpoint, { key: config.key });
		this.docRepo = new DocumentRepository();
	}

	private mapAnalyzeResult(documentId: number, analyzeResult: any): OCRResult {
		const content = analyzeResult?.content || "";
		const confidence = analyzeResult?.documents?.[0]?.confidence || 0;
		const structuredData: Record<string, any> = analyzeResult?.documents?.[0] || {};
		const extractedFields: Record<string, any> = {};

		if (analyzeResult?.keyValuePairs) {
			for (const kvp of analyzeResult.keyValuePairs) {
				if (kvp.key?.content && kvp.value?.content) {
					extractedFields[kvp.key.content] = kvp.value.content;
				}
			}
		}

		return {
			id: documentId.toString(),
			content,
			confidence,
			structuredData,
			extractedFields,
		};
	}

	private async analyzeBuffer(
		documentId: number,
		fileBuffer: Buffer,
		modelId: string,
		meta?: { chunkIndex?: number; chunkTotal?: number; pageOffset?: number; pageCount?: number },
	): Promise<OCRResult> {
		const label =
			meta?.chunkIndex != null
				? `chunk ${meta.chunkIndex + 1}/${meta.chunkTotal}`
				: "single";

		const maxBytes = getMaxChunkBytes();
		if (fileBuffer.byteLength > maxBytes) {
			throw new Error(
				`Chunk ${label} is ${fileBuffer.byteLength} bytes > Azure max ${maxBytes}. ` +
					`Set AZURE_MAX_CHUNK_BYTES higher on paid tier, or ensure size-aware split ran.`,
			);
		}

		pipelineLog(documentId, PipelineStage.OCR_CHUNK_STARTED, {
			label,
			bytes: fileBuffer.byteLength,
			modelId,
			apiVersion: this.apiVersion,
			maxBytes,
			...meta,
		});

		const started = Date.now();
		pipelineLog(documentId, PipelineStage.OCR_AZURE_SUBMITTING, {
			label,
			bytes: fileBuffer.byteLength,
			modelId,
			apiVersion: this.apiVersion,
			note: "POST analyze (Document Intelligence 2024-11-30)",
			...meta,
		});

		const submitHeartbeat = setInterval(() => {
			pipelineLog(documentId, PipelineStage.OCR_AZURE_SUBMITTING, {
				label,
				bytes: fileBuffer.byteLength,
				elapsedMs: Date.now() - started,
				note: "still uploading/starting Azure analyze…",
				...meta,
			});
		}, 15_000);

		let initialResponse;
		try {
			initialResponse = await this.client
				.path("/documentModels/{modelId}:analyze", modelId)
				.post({
					contentType: "application/octet-stream",
					body: fileBuffer,
				});
		} finally {
			clearInterval(submitHeartbeat);
		}

		if (isUnexpected(initialResponse)) {
			const errBody = initialResponse.body as any;
			const code = errBody?.error?.innererror?.code || errBody?.error?.code || initialResponse.status;
			const message =
				errBody?.error?.innererror?.message ||
				errBody?.error?.message ||
				`Azure analyze failed with status ${initialResponse.status}`;
			throw new Error(`Azure Document Intelligence ${code}: ${message}`);
		}

		pipelineLog(documentId, PipelineStage.OCR_AZURE_SUBMITTED, {
			label,
			submitMs: Date.now() - started,
			status: initialResponse.status,
			...meta,
		});

		const poller = getLongRunningPoller(this.client, initialResponse);
		const pollHeartbeat = setInterval(() => {
			pipelineLog(documentId, PipelineStage.OCR_AZURE_POLLING, {
				label,
				elapsedMs: Date.now() - started,
				note: "waiting for Azure operation…",
				...meta,
			});
		}, 15_000);

		let finalResult: any;
		try {
			finalResult = await poller.pollUntilDone();
		} finally {
			clearInterval(pollHeartbeat);
		}

		if (isUnexpected(finalResult as any)) {
			const errBody = (finalResult as any).body;
			const message = errBody?.error?.message || "Azure analyze poll failed";
			throw new Error(message);
		}

		const body = (finalResult as any).body;
		const analyzeResult = body?.analyzeResult ?? body;
		const mapped = this.mapAnalyzeResult(documentId, analyzeResult);

		pipelineLog(documentId, PipelineStage.OCR_CHUNK_COMPLETED, {
			label,
			ms: Date.now() - started,
			contentLength: mapped.content.length,
			confidence: mapped.confidence,
			...meta,
		});

		return mapped;
	}

	async processDocumentFromBuffer(documentId: number, fileBuffer: Buffer): Promise<OCRResult> {
		const started = Date.now();
		const maxBytes = getMaxChunkBytes();
		const maxPages = getMaxPagesPerChunk();

		try {
			await logPipelineStage(documentId, PipelineStage.OCR_STARTED, {
				bytes: fileBuffer.byteLength,
				isPdf: isPdfBuffer(fileBuffer),
				apiVersion: this.apiVersion,
				maxChunkBytes: maxBytes,
				maxChunkPages: maxPages,
			});

			const modelId = ModelManager.getModelForDocumentType("document");
			let ocrResult: OCRResult;

			if (isPdfBuffer(fileBuffer)) {
				const pageCount = await getPdfPageCount(fileBuffer);
				const split = shouldSplit(fileBuffer.byteLength, pageCount, maxBytes, maxPages);

				await logPipelineStage(documentId, PipelineStage.OCR_INSPECTING, {
					pageCount,
					bytes: fileBuffer.byteLength,
					shouldSplit: split,
					modelId,
					maxChunkBytes: maxBytes,
					maxChunkPages: maxPages,
					apiVersion: this.apiVersion,
				});

				if (split) {
					await logPipelineStage(documentId, PipelineStage.OCR_SPLIT_STARTED, {
						pageCount,
						bytes: fileBuffer.byteLength,
						maxPagesPerChunk: maxPages,
						maxBytesPerChunk: maxBytes,
					});

					const chunks = await splitPdfByPages(
						fileBuffer,
						maxPages,
						(progress) => {
							pipelineLog(documentId, PipelineStage.OCR_SPLIT_PROGRESS, progress as Record<string, unknown>);
						},
						maxBytes,
					);

					const oversized = chunks.filter((c) => c.buffer.byteLength > maxBytes);
					if (oversized.length > 0) {
						throw new Error(
							`${oversized.length} chunk(s) still exceed ${maxBytes} bytes after split`,
						);
					}

					await logPipelineStage(documentId, PipelineStage.OCR_SPLIT_DONE, {
						chunkCount: chunks.length,
						pageOffsets: chunks.map((c) => c.pageOffset),
						pageCounts: chunks.map((c) => c.pageCount),
						chunkBytes: chunks.map((c) => c.buffer.byteLength),
						maxChunkBytes: maxBytes,
					});

					const chunkResults: ChunkOcrResult[] = [];
					for (let i = 0; i < chunks.length; i++) {
						const chunk = chunks[i]!;
						chunkResults.push(
							await this.analyzeBuffer(documentId, chunk.buffer, modelId, {
								chunkIndex: i,
								chunkTotal: chunks.length,
								pageOffset: chunk.pageOffset,
								pageCount: chunk.pageCount,
							}),
						);
					}
					ocrResult = reassembleOcrResults(chunkResults, chunks, documentId.toString());
					await logPipelineStage(documentId, PipelineStage.OCR_REASSEMBLED, {
						chunkCount: chunks.length,
						contentLength: ocrResult.content.length,
						confidence: ocrResult.confidence,
					});
				} else {
					await logPipelineStage(documentId, PipelineStage.OCR_SINGLE, {
						pageCount,
						bytes: fileBuffer.byteLength,
						modelId,
					});
					ocrResult = await this.analyzeBuffer(documentId, fileBuffer, modelId);
				}
			} else {
				if (fileBuffer.byteLength > maxBytes) {
					throw new Error(
						`Non-PDF file is ${fileBuffer.byteLength} bytes > Azure max ${maxBytes}. Compress or upgrade tier.`,
					);
				}
				await logPipelineStage(documentId, PipelineStage.OCR_SINGLE, {
					bytes: fileBuffer.byteLength,
					modelId,
					isPdf: false,
				});
				ocrResult = await this.analyzeBuffer(documentId, fileBuffer, modelId);
			}

			await logPipelineStage(documentId, PipelineStage.OCR_COMPLETED, {
				ms: Date.now() - started,
				contentLength: ocrResult.content.length,
				confidence: ocrResult.confidence,
				fieldCount: Object.keys(ocrResult.extractedFields || {}).length,
			});

			return ocrResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			console.error(`[DOC ${documentId}] OCR failed:`, error);
			await this.docRepo.updateStatus(documentId, DocumentStatus.FAILED, message);
			await logPipelineStage(documentId, PipelineStage.FAILED, {
				stage: "ocr",
				error: message,
				ms: Date.now() - started,
			});
			throw error;
		}
	}

	async processDocumentById(documentId: number): Promise<OCRResult> {
		const document = await this.docRepo.findById(documentId);
		if (!document) {
			throw new Error(`Document ${documentId} not found`);
		}

		await this.docRepo.updateStatus(documentId, DocumentStatus.PROCESSING);
		return this.processDocumentFromBuffer(documentId, document.fullContent as Buffer);
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
