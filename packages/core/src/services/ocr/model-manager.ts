// Model manager for handling different Azure models
// Extensible for custom trained models in the future

export class ModelManager {
	private static readonly PREBUILT_MODELS = {
		document: 'prebuilt-document',
		layout: 'prebuilt-layout',
		invoice: 'prebuilt-invoice',
		receipt: 'prebuilt-receipt',
		businessCard: 'prebuilt-businessCard',
		idDocument: 'prebuilt-idDocument',
		default: 'prebuilt-contract',
	}

	static getModelForDocumentType(documentType: string): string {
		// For now, use general document model for all legal documents
		// In the future, we can add specific models for different document types
		switch (documentType.toLowerCase()) {
			case 'invoice':
				return this.PREBUILT_MODELS.invoice
			case 'receipt':
				return this.PREBUILT_MODELS.receipt
			case 'business_card':
				return this.PREBUILT_MODELS.businessCard
			case 'id_document':
				return this.PREBUILT_MODELS.idDocument
			default:
				return this.PREBUILT_MODELS.default
		}
	}

	static isValidModelId(modelId: string): boolean {
		const allModels = Object.values(this.PREBUILT_MODELS)
		return allModels.includes(modelId as any) || modelId.startsWith('custom-')
	}

	// Placeholder for future custom model management
	static async getCustomModels(): Promise<string[]> {
		// TODO: Implement Azure Custom Model API integration
		return []
	}

	static async createCustomModel(modelName: string): Promise<string> {
		// TODO: Implement model training
		throw new Error('Custom model training not yet implemented')
	}
}
