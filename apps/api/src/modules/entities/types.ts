export interface EntityAppearance {
	participantId: number
	documentId: number
	filename: string
	caseId: number | null
	caseNumber: string | null
	documentType: string
	role: string
	roleConfidence: number | null
	mentionCount: number
	relevanceScore: number | null
	mentions: string[] | null
	clusterId: number | null
}

export interface CoOccurring {
	normalizedName: string
	displayName: string
	docCount: number
	roles: string[]
}

export interface MentionContextItem {
	participantId: number
	documentId: number
	participantName: string
	allMentions: string[]
	caseId: number | null
	caseNumber: string | null
	filename: string
	mentions: { text: string; start: number; end: number; context: string }[]
}

export interface ConfidenceResult {
	overallScore: number
	roleConsistency: number
	documentCoverage: number
	roles: { role: string; count: number; documents: number }[]
	flags: string[]
}

export interface EntityDossier {
	normalizedName: string
	displayName: string
	totalMentions: number
	totalDocuments: number
	totalCases: number
	roleDistribution: { role: string; count: number; percentage: number }[]
	primaryRole: string
	appearances: EntityAppearance[]
	coOccurringEntities: CoOccurring[]
	mentionContexts: MentionContextItem[]
	confidence: ConfidenceResult
}

export interface CoOccurrenceNode {
	normalizedName: string
	displayName: string
	role: string
	connections: number
}

export interface CoOccurrenceEdge {
	source: string
	target: string
	weight: number
}

export interface CoOccurrenceNetwork {
	nodes: CoOccurrenceNode[]
	edges: CoOccurrenceEdge[]
}
