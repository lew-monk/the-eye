export interface AzureConfig {
	endpoint: string
	apiKey: string
}

export function getAzureConfig(): AzureConfig {
	const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
	const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY

	if (!endpoint || !apiKey) {
		throw new Error('Azure Document Intelligence configuration missing. Please set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY environment variables.')
	}

	return {
		endpoint,
		apiKey,
	}
}
