import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { PDFDocument } from 'pdf-lib'

const mockUpdateStatus = mock().mockResolvedValue(undefined)

async function makePdf(pageCount: number): Promise<Buffer> {
	const doc = await PDFDocument.create()
	for (let i = 0; i < pageCount; i++) {
		doc.addPage()
	}
	return Buffer.from(await doc.save())
}

describe('AzureOCRService chunked processing', () => {
	const analyzeCalls: Buffer[] = []

	beforeEach(() => {
		analyzeCalls.length = 0
		mockUpdateStatus.mockReset()
		mockUpdateStatus.mockResolvedValue(undefined)
		process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = 'https://example.cognitiveservices.azure.com/'
		process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'test-key'
	})

	async function createService() {
		const { AzureOCRService } = await import('../src/ocr')
		const service = new AzureOCRService()
		// Inject mocks — avoid mock.module('@workspace/shared') so other test files stay isolated
		;(service as any).docRepo = { updateStatus: mockUpdateStatus }
		return service
	}

	it('sends small PDFs as a single analyze call and does not mark completed', async () => {
		const service = await createService()
		const buffer = await makePdf(2)

		;(service as any).analyzeBuffer = async (
			documentId: number,
			fileBuffer: Buffer,
		) => {
			analyzeCalls.push(fileBuffer)
			return {
				id: String(documentId),
				content: 'small doc',
				confidence: 0.95,
				extractedFields: {},
				structuredData: {},
			}
		}

		const result = await service.processDocumentFromBuffer(42, buffer)

		expect(analyzeCalls).toHaveLength(1)
		expect(result.content).toBe('small doc')
		expect(result.confidence).toBe(0.95)
		// completed is owned by the queue/sync caller after persist
		expect(mockUpdateStatus).not.toHaveBeenCalledWith(42, 'completed', undefined)
	})

	it('splits large page-count PDFs and reassembles results', async () => {
		const service = await createService()
		const { DEFAULT_MAX_PAGES_PER_CHUNK } = await import('../src/services/ocr/pdf-chunker')
		const totalPages = DEFAULT_MAX_PAGES_PER_CHUNK + 10
		const buffer = await makePdf(totalPages)

		let call = 0
		// Mock Document Intelligence REST client shape
		;(service as any).client = {
			path: () => ({
				post: async ({ body }: { body: Buffer }) => {
					analyzeCalls.push(body)
					call += 1
					return {
						status: '202',
						body: {},
						headers: { 'operation-location': `https://example/ops/${call}` },
					}
				},
			}),
		}

		// Bypass poller by stubbing analyzeBuffer path via monkeypatch after construct
		const originalAnalyze = (service as any).analyzeBuffer.bind(service)
		;(service as any).analyzeBuffer = async (
			documentId: number,
			fileBuffer: Buffer,
			_modelId: string,
			meta?: { chunkIndex?: number },
		) => {
			analyzeCalls.push(fileBuffer)
			const n = (meta?.chunkIndex ?? 0) + 1
			return {
				id: String(documentId),
				content: `chunk-${n}`,
				confidence: n === 1 ? 0.9 : 0.7,
				extractedFields: { [`k${n}`]: `v${n}` },
				structuredData: {},
			}
		}

		const result = await service.processDocumentFromBuffer(99, buffer)

		expect(analyzeCalls.length).toBeGreaterThan(1)
		expect(result.content.startsWith('chunk-1')).toBe(true)
		expect(result.extractedFields?.k1).toBe('v1')
		expect(mockUpdateStatus).not.toHaveBeenCalledWith(99, 'completed', undefined)
		// restore unused ref
		void originalAnalyze
	})

	it('marks document failed when azure throws', async () => {
		const service = await createService()
		const buffer = await makePdf(1)

		;(service as any).analyzeBuffer = async () => {
			throw new Error('Azure unavailable')
		}

		await expect(service.processDocumentFromBuffer(7, buffer)).rejects.toThrow('Azure unavailable')
		expect(mockUpdateStatus).toHaveBeenCalledWith(7, 'failed', 'Azure unavailable')
	})
})
