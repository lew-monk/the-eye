import { documentRepository, participantRepository } from '@workspace/shared'
import { GraphService } from './graph'
import { CaseNetworkViews } from './network-views'
import { parseFocus, focusNodeId } from './network-helpers'
import type { CaseNetwork, CaseNetworkEdge, CaseNetworkNode, NetworkFocus } from './types'

export abstract class CaseNetworkService {
	static async getCaseNetwork(caseId: number, entityCap = 24): Promise<CaseNetwork> {
		const docs = await documentRepository.findByCaseId(caseId)
		const graph = await GraphService.getDocumentGraph(caseId)

		const byName = new Map<
			string,
			{
				name: string
				normalizedName: string
				role: string
				mentionCount: number
				relevanceScore: number
				documentIds: Set<number>
				roleCounts: Map<string, number>
			}
		>()

		for (const doc of docs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const key = p.normalizedName
				const existing = byName.get(key)
				const role = p.role || 'other'
				if (!existing) {
					byName.set(key, {
						name: p.name,
						normalizedName: p.normalizedName,
						role,
						mentionCount: p.mentionCount ?? 0,
						relevanceScore: p.relevanceScore ?? 0,
						documentIds: new Set([doc.id]),
						roleCounts: new Map([[role, 1]]),
					})
				} else {
					existing.mentionCount += p.mentionCount ?? 0
					existing.documentIds.add(doc.id)
					existing.roleCounts.set(role, (existing.roleCounts.get(role) ?? 0) + 1)
					const bestRole = [...existing.roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]
					if (bestRole) existing.role = bestRole[0]
					if ((p.relevanceScore ?? 0) > existing.relevanceScore) {
						existing.relevanceScore = p.relevanceScore ?? 0
						existing.name = p.name
					}
				}
			}
		}

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const caseNodeId = `case:${caseId}`
		const caseNumber = docs[0]?.caseNumber ?? `CASE-${caseId}`

		nodes.push({
			id: caseNodeId,
			kind: 'case',
			label: caseNumber,
			sublabel: docs[0]?.documentType,
			weight: 4,
			caseId,
			documentCount: docs.length,
		})

		for (const doc of docs) {
			const id = `doc:${doc.id}`
			nodes.push({
				id,
				kind: 'document',
				label: doc.filename,
				sublabel: doc.documentType?.replace(/_/g, ' '),
				documentType: doc.documentType,
				documentId: doc.id,
				weight: 2,
			})
			edges.push({ source: caseNodeId, target: id, kind: 'has_document' })
		}

		const entityList = [...byName.values()].sort((a, b) => {
			if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount
			return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)
		})

		const roleCounts = new Map<string, number>()
		for (const e of entityList) {
			roleCounts.set(e.role, (roleCounts.get(e.role) ?? 0) + 1)
		}

		for (const [role, count] of [...roleCounts.entries()].sort((a, b) => b[1] - a[1])) {
			const id = `role:${role}`
			nodes.push({
				id,
				kind: 'role',
				label: role.replace(/_/g, ' '),
				role,
				weight: Math.min(3, 1 + count / 2),
				mentionCount: count,
			})
			edges.push({ source: caseNodeId, target: id, kind: 'has_role' })
		}

		const kept = entityList.slice(0, entityCap)
		for (const e of kept) {
			const id = `entity:${e.normalizedName}`
			nodes.push({
				id,
				kind: 'entity',
				label: e.name,
				sublabel: e.role.replace(/_/g, ' '),
				role: e.role,
				normalizedName: e.normalizedName,
				mentionCount: e.mentionCount,
				documentCount: e.documentIds.size,
				weight: 1 + Math.min(2, e.mentionCount / 8),
			})
			edges.push({ source: `role:${e.role}`, target: id, kind: 'has_entity' })
			for (const docId of e.documentIds) {
				edges.push({ source: id, target: `doc:${docId}`, kind: 'mentioned_in' })
			}
		}

		for (const e of graph.edges) {
			edges.push({
				source: `doc:${e.sourceDocumentId}`,
				target: `doc:${e.targetDocumentId}`,
				kind: 'doc_ref',
				label: e.label,
			})
		}

		return {
			focusId: caseNodeId,
			focusType: 'case',
			caseId,
			caseNumber,
			title: '',
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: entityList.length,
				roles: roleCounts.size,
				documents: docs.length,
				cases: 1,
				links: edges.length,
				hiddenEntities: Math.max(0, entityList.length - kept.length),
			},
		}
	}

	static parseFocus = parseFocus
	static focusNodeId = focusNodeId

	static async getFocusNetwork(focus: NetworkFocus, entityCap = 24): Promise<CaseNetwork | null> {
		if (focus.type === 'case') {
			const caseId = Number(focus.id)
			if (Number.isNaN(caseId)) return null
			return CaseNetworkService.getCaseNetwork(caseId, entityCap)
		}
		if (focus.type === 'entity') {
			return CaseNetworkViews.getEntityNetwork(focus.id, entityCap)
		}
		if (focus.type === 'document') {
			const documentId = Number(focus.id)
			if (Number.isNaN(documentId)) return null
			return CaseNetworkViews.getDocumentNetwork(documentId, entityCap)
		}
		return CaseNetworkViews.getRoleNetwork(focus.id, focus.caseId, entityCap)
	}
}
