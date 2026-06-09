export interface ConfidenceConfig {
	default: number
	judgment: number
	contract: number
	policeReport: number
	witnessStatement: number
	pleading: number
}

export function getConfidenceConfig(): ConfidenceConfig {
	return {
		default: parseFloat(process.env.CONFIDENCE_THRESHOLD_DEFAULT || '0.7'),
		judgment: parseFloat(process.env.CONFIDENCE_THRESHOLD_JUDGMENT || '0.8'),
		contract: parseFloat(process.env.CONFIDENCE_THRESHOLD_CONTRACT || '0.75'),
		policeReport: parseFloat(process.env.CONFIDENCE_THRESHOLD_POLICE_REPORT || '0.7'),
		witnessStatement: parseFloat(process.env.CONFIDENCE_THRESHOLD_WITNESS_STATEMENT || '0.7'),
		pleading: parseFloat(process.env.CONFIDENCE_THRESHOLD_PLEADING || '0.75'),
	}
}

export function getConfidenceThreshold(documentType: string): number {
	const config = getConfidenceConfig()

	switch (documentType.toLowerCase()) {
		case 'judgment':
		case 'court_order':
			return config.judgment
		case 'contract':
		case 'agreement':
			return config.contract
		case 'police_report':
		case 'incident_report':
			return config.policeReport
		case 'witness_statement':
		case 'affidavit':
			return config.witnessStatement
		case 'pleading':
		case 'motion':
		case 'brief':
			return config.pleading
		default:
			return config.default
	}
}

export function isConfidenceAcceptable(confidence: number, documentType: string): boolean {
	const threshold = getConfidenceThreshold(documentType)
	return confidence >= threshold
}
