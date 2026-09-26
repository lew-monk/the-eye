import { CaseOverviewService } from './overview'
import { ChronologyService } from './chronology'
import { GraphService } from './graph'
import { CaseNetworkService } from './network'
import { CaseNetworkViews } from './network-views'
import { CaseIntelligenceService } from './intelligence'
import { CaseMentionService } from './mentions'

export type {
	CaseEntity,
	CaseEntityConfidence,
	CaseNetwork,
	CaseNetworkEdge,
	CaseNetworkEdgeKind,
	CaseNetworkNode,
	CaseNetworkNodeKind,
	ChronologyEvent,
	ChronologyPage,
	DocumentGraph,
	DocumentGraphEdge,
	DocumentGraphNode,
	EntityTrajectory,
	EntityTrajectoryPoint,
	IntelligenceSignalType,
	NetworkFocus,
	NetworkFocusType,
	RoleVarianceFlag,
} from './types'

export abstract class CasesService {
	static getCaseChunks = CaseOverviewService.getCaseChunks
	static getCaseEntities = CaseOverviewService.getCaseEntities
	static extractDocumentDate = ChronologyService.extractDocumentDate
	static getDocumentChronology = ChronologyService.getDocumentChronology
	static getReferenceLinks = GraphService.getReferenceLinks
	static matchDocumentReference = GraphService.matchDocumentReference
	static getDocumentGraph = GraphService.getDocumentGraph
	static getCaseNetwork = CaseNetworkService.getCaseNetwork
	static parseFocus = CaseNetworkService.parseFocus
	static focusNodeId = CaseNetworkService.focusNodeId
	static getFocusNetwork = CaseNetworkService.getFocusNetwork
	static getEntityNetwork = CaseNetworkViews.getEntityNetwork
	static getDocumentNetwork = CaseNetworkViews.getDocumentNetwork
	static getRoleNetwork = CaseNetworkViews.getRoleNetwork
	static getRoleVarianceFlags = CaseIntelligenceService.getRoleVarianceFlags
	static getEntityTrajectories = CaseIntelligenceService.getEntityTrajectories
	static classifyTrajectory = CaseIntelligenceService.classifyTrajectory
	static getIntelligenceGraph = CaseIntelligenceService.getIntelligenceGraph
	static mentionSourceText = CaseMentionService.mentionSourceText
	static excerptMention = CaseMentionService.excerptMention
	static addManualParticipant = CaseMentionService.addManualParticipant
	static getMentionContexts = CaseMentionService.getMentionContexts
	static getEntityMentionContexts = CaseMentionService.getEntityMentionContexts
}
