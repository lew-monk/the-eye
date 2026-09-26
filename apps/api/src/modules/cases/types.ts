import type { EventKind } from './linker'

export interface CaseEntityConfidence {
	score: number
	roleConsistency: number
	documentCoverage: number
	flags: string[]
	roleBreakdown: { role: string; count: number; confidence: number }[]
}

export interface CaseEntity {
	id: number
	name: string
	normalizedName: string
	role: string
	roleConfidence: number | null
	mentionCount: number
	relevanceScore: number | null
	mentions: string[] | null
	documentCount: number
	totalDocsInCase: number
	confidence: CaseEntityConfidence
}

export interface DocumentGraphNode {
	documentId: number
	filename: string
	documentType: string
	dates: { date: string; kind: EventKind }[]
}

export interface DocumentGraphEdge {
	sourceDocumentId: number
	targetDocumentId: number
	relationType: 'explicit_reference' | 'implicit_subset'
	label: string
}

export interface DocumentGraph {
	nodes: DocumentGraphNode[]
	edges: DocumentGraphEdge[]
}

export type CaseNetworkNodeKind =
	| 'case'
	| 'document'
	| 'entity'
	| 'role'
	| 'signal'
	| 'similar_case'

export type IntelligenceSignalType =
	| 'role_variance'
	| 'surge'
	| 'drop'
	| 'unresolved'
	| 'similar'
export type NetworkFocusType = 'case' | 'entity' | 'document' | 'role'

export type CaseNetworkEdgeKind =
	| 'has_document'
	| 'has_role'
	| 'has_entity'
	| 'mentioned_in'
	| 'doc_ref'
	| 'in_case'
	| 'co_occurs'
	| 'connected_case'
	| 'has_signal'
	| 'about'
	| 'similar_to'

export interface NetworkFocus {
	type: NetworkFocusType
	id: string
	caseId?: number
}

export interface CaseNetworkNode {
	id: string
	kind: CaseNetworkNodeKind
	label: string
	sublabel?: string
	role?: string
	weight: number
	mentionCount?: number
	documentCount?: number
	documentType?: string
	caseId?: number
	documentId?: number
	normalizedName?: string
	signal?: IntelligenceSignalType
	detail?: string
}

export interface CaseNetworkEdge {
	source: string
	target: string
	kind: CaseNetworkEdgeKind
	label?: string
}

export interface CaseNetwork {
	focusId: string
	focusType: NetworkFocusType
	caseId: number
	caseNumber: string
	title: string
	caseType: string
	status: string
	nodes: CaseNetworkNode[]
	edges: CaseNetworkEdge[]
	totals: {
		entities: number
		roles: number
		documents: number
		cases: number
		links: number
		hiddenEntities: number
	}
}

export interface ChronologyEvent {
	id: string
	documentId: number
	filename: string
	documentType: string
	date: string
	dateSource: string
	kind: EventKind
	quote: string | null
	summary: string
	entities: { normalizedName: string; name: string; role: string; mentionCount: number }[]
	unresolvedRefs: string[]
}

export interface ChronologyPage {
	events: ChronologyEvent[]
	totalEvents: number
	totalDates: number
}

export interface RoleVarianceFlag {
	normalizedName: string
	displayName: string
	roles: { role: string; documentIds: number[]; count: number }[]
	primaryRole: string
	flag: string
}

export interface EntityTrajectoryPoint {
	documentId: number
	filename: string
	documentType: string
	date: string | null
	mentionCount: number
	role: string
}

export interface EntityTrajectory {
	normalizedName: string
	displayName: string
	points: EntityTrajectoryPoint[]
}
