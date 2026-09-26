import { documentRepository, participantRepository } from '@workspace/shared'
import { GraphService } from './graph'
import { pushEdge, pushNode } from './network-helpers'
import type { CaseNetwork, CaseNetworkEdge, CaseNetworkNode } from './types'

export abstract class CaseNetworkViews {
	static async getEntityNetwork(normalizedName: string, entityCap = 16): Promise<CaseNetwork | null> {
		const found = await participantRepository.search({
			name: normalizedName,
			limit: 100,
		})
		const rows = (found.data ?? []).filter(
			(p) => p.normalizedName === normalizedName || p.normalizedName.includes(normalizedName),
		)
		const exact = rows.filter((p) => p.normalizedName === normalizedName)
		const appearances = exact.length > 0 ? exact : rows
		if (appearances.length === 0) return null

		const displayName = appearances[0]?.name ?? normalizedName
		const primaryRole = appearances
			.map((p) => p.role || 'other')
			.sort(
				(a, b) =>
					appearances.filter((p) => (p.role || 'other') === b).length -
					appearances.filter((p) => (p.role || 'other') === a).length,
			)[0] ?? 'other'

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const entityId = `entity:${normalizedName}`
		const mentionCount = appearances.reduce((s, p) => s + (p.mentionCount ?? 0), 0)
		const docIds = [...new Set(appearances.map((p) => p.documentId))]

		pushNode(nodes, {
			id: entityId,
			kind: 'entity',
			label: displayName,
			sublabel: primaryRole.replace(/_/g, ' '),
			role: primaryRole,
			normalizedName,
			mentionCount,
			documentCount: docIds.length,
			weight: 4,
		})

		const cases = new Map<number, { caseNumber: string }>()
		for (const p of appearances) {
			const docId = `doc:${p.documentId}`
			pushNode(nodes, {
				id: docId,
				kind: 'document',
				label: `DOC-${p.documentId}`,
				sublabel: (p.documentType ?? '').replace(/_/g, ' '),
				documentType: p.documentType,
				documentId: p.documentId,
				caseId: p.caseId ?? undefined,
				weight: 2,
			})
			pushEdge(edges, { source: entityId, target: docId, kind: 'mentioned_in' })

			const role = p.role || 'other'
			const roleId = `role:${role}`
			pushNode(nodes, {
				id: roleId,
				kind: 'role',
				label: role.replace(/_/g, ' '),
				role,
				weight: 2,
			})
			pushEdge(edges, { source: entityId, target: roleId, kind: 'has_role' })

			if (p.caseId != null) {
				cases.set(p.caseId, { caseNumber: p.caseNumber ?? `CASE-${p.caseId}` })
				const caseId = `case:${p.caseId}`
				pushNode(nodes, {
					id: caseId,
					kind: 'case',
					label: p.caseNumber ?? `CASE-${p.caseId}`,
					weight: 3,
					caseId: p.caseId,
				})
				pushEdge(edges, { source: docId, target: caseId, kind: 'in_case' })
				pushEdge(edges, { source: caseId, target: entityId, kind: 'has_entity' })
			}
		}

		for (const documentId of docIds) {
			const doc = await documentRepository.findById(documentId)
			const node = nodes.find((n) => n.id === `doc:${documentId}`)
			if (node && doc) {
				node.label = doc.filename
				node.documentType = doc.documentType
				node.sublabel = doc.documentType?.replace(/_/g, ' ')
				if (doc.caseId != null) node.caseId = doc.caseId
			}
			const parts = await participantRepository.findByDocumentId(documentId)
			for (const other of parts) {
				if (other.normalizedName === normalizedName) continue
				if (nodes.filter((n) => n.kind === 'entity').length >= entityCap + 1) break
				const otherId = `entity:${other.normalizedName}`
				pushNode(nodes, {
					id: otherId,
					kind: 'entity',
					label: other.name,
					sublabel: (other.role || 'other').replace(/_/g, ' '),
					role: other.role || 'other',
					normalizedName: other.normalizedName,
					mentionCount: other.mentionCount ?? 0,
					weight: 1,
				})
				pushEdge(edges, {
					source: entityId,
					target: otherId,
					kind: 'co_occurs',
					label: doc?.filename,
				})
				pushEdge(edges, {
					source: otherId,
					target: `doc:${documentId}`,
					kind: 'mentioned_in',
				})
			}
		}

		const firstCase = [...cases.entries()][0]
		return {
			focusId: entityId,
			focusType: 'entity',
			caseId: firstCase?.[0] ?? 0,
			caseNumber: firstCase?.[1].caseNumber ?? '',
			title: displayName,
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: nodes.filter((n) => n.kind === 'entity').length,
				roles: nodes.filter((n) => n.kind === 'role').length,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: cases.size,
				links: edges.length,
				hiddenEntities: 0,
			},
		}
	}

	static async getDocumentNetwork(documentId: number, entityCap = 24): Promise<CaseNetwork | null> {
		const doc = await documentRepository.findById(documentId)
		if (!doc) return null

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const docNodeId = `doc:${doc.id}`

		pushNode(nodes, {
			id: docNodeId,
			kind: 'document',
			label: doc.filename,
			sublabel: doc.documentType?.replace(/_/g, ' '),
			documentType: doc.documentType,
			documentId: doc.id,
			caseId: doc.caseId ?? undefined,
			weight: 4,
		})

		if (doc.caseId != null) {
			const caseId = `case:${doc.caseId}`
			pushNode(nodes, {
				id: caseId,
				kind: 'case',
				label: doc.caseNumber ?? `CASE-${doc.caseId}`,
				weight: 3,
				caseId: doc.caseId,
			})
			pushEdge(edges, { source: caseId, target: docNodeId, kind: 'has_document' })

			const siblings = await documentRepository.findByCaseId(doc.caseId)
			for (const sib of siblings) {
				if (sib.id === doc.id) continue
				const sibId = `doc:${sib.id}`
				pushNode(nodes, {
					id: sibId,
					kind: 'document',
					label: sib.filename,
					sublabel: sib.documentType?.replace(/_/g, ' '),
					documentType: sib.documentType,
					documentId: sib.id,
					caseId: doc.caseId,
					weight: 2,
				})
				pushEdge(edges, { source: caseId, target: sibId, kind: 'has_document' })
			}

			const graph = await GraphService.getDocumentGraph(doc.caseId)
			for (const e of graph.edges) {
				if (e.sourceDocumentId !== doc.id && e.targetDocumentId !== doc.id) continue
				pushEdge(edges, {
					source: `doc:${e.sourceDocumentId}`,
					target: `doc:${e.targetDocumentId}`,
					kind: 'doc_ref',
					label: e.label,
				})
			}
		}

		const parts = await participantRepository.findByDocumentId(doc.id)
		const roleCounts = new Map<string, number>()
		for (const p of parts) {
			const role = p.role || 'other'
			roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1)
		}
		for (const [role, count] of roleCounts) {
			const roleId = `role:${role}`
			pushNode(nodes, {
				id: roleId,
				kind: 'role',
				label: role.replace(/_/g, ' '),
				role,
				mentionCount: count,
				weight: 2,
			})
			pushEdge(edges, { source: docNodeId, target: roleId, kind: 'has_role' })
		}

		const kept = [...parts]
			.sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
			.slice(0, entityCap)
		for (const p of kept) {
			const entityId = `entity:${p.normalizedName}`
			pushNode(nodes, {
				id: entityId,
				kind: 'entity',
				label: p.name,
				sublabel: (p.role || 'other').replace(/_/g, ' '),
				role: p.role || 'other',
				normalizedName: p.normalizedName,
				mentionCount: p.mentionCount ?? 0,
				weight: 1 + Math.min(2, (p.mentionCount ?? 0) / 8),
			})
			pushEdge(edges, { source: entityId, target: docNodeId, kind: 'mentioned_in' })
			pushEdge(edges, {
				source: `role:${p.role || 'other'}`,
				target: entityId,
				kind: 'has_entity',
			})
		}

		return {
			focusId: docNodeId,
			focusType: 'document',
			caseId: doc.caseId ?? 0,
			caseNumber: doc.caseNumber ?? '',
			title: doc.filename,
			caseType: doc.documentType ?? '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: parts.length,
				roles: roleCounts.size,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: doc.caseId != null ? 1 : 0,
				links: edges.length,
				hiddenEntities: Math.max(0, parts.length - kept.length),
			},
		}
	}

	static async getRoleNetwork(
		role: string,
		caseId?: number,
		entityCap = 24,
	): Promise<CaseNetwork | null> {
		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const roleId = `role:${role}`
		pushNode(nodes, {
			id: roleId,
			kind: 'role',
			label: role.replace(/_/g, ' '),
			role,
			weight: 4,
		})

		type Row = {
			name: string
			normalizedName: string
			role: string
			mentionCount: number
			documentId: number
			caseId: number | null
			caseNumber: string | null
			documentType?: string
			filename?: string
		}
		const rows: Row[] = []

		if (caseId != null) {
			const docs = await documentRepository.findByCaseId(caseId)
			for (const doc of docs) {
				const parts = await participantRepository.findByDocumentId(doc.id)
				for (const p of parts) {
					if ((p.role || 'other') !== role) continue
					rows.push({
						name: p.name,
						normalizedName: p.normalizedName,
						role: p.role || 'other',
						mentionCount: p.mentionCount ?? 0,
						documentId: doc.id,
						caseId: doc.caseId ?? caseId,
						caseNumber: doc.caseNumber ?? null,
						documentType: doc.documentType,
						filename: doc.filename,
					})
				}
			}
		} else {
			const found = await participantRepository.search({ role, limit: 80 })
			for (const p of found.data ?? []) {
				if ((p.role || 'other') !== role) continue
				rows.push({
					name: p.name,
					normalizedName: p.normalizedName,
					role: p.role || 'other',
					mentionCount: p.mentionCount ?? 0,
					documentId: p.documentId,
					caseId: p.caseId ?? null,
					caseNumber: p.caseNumber ?? null,
					documentType: p.documentType,
				})
			}
		}

		if (rows.length === 0) {
			return {
				focusId: roleId,
				focusType: 'role',
				caseId: caseId ?? 0,
				caseNumber: '',
				title: role.replace(/_/g, ' '),
				caseType: '',
				status: '',
				nodes,
				edges,
				totals: {
					entities: 0,
					roles: 1,
					documents: 0,
					cases: 0,
					links: 0,
					hiddenEntities: 0,
				},
			}
		}

		const byEntity = new Map<string, Row[]>()
		for (const row of rows) {
			const list = byEntity.get(row.normalizedName) ?? []
			list.push(row)
			byEntity.set(row.normalizedName, list)
		}

		const ranked = [...byEntity.entries()].sort((a, b) => {
			const ma = a[1].reduce((s, r) => s + r.mentionCount, 0)
			const mb = b[1].reduce((s, r) => s + r.mentionCount, 0)
			return mb - ma
		})
		const kept = ranked.slice(0, entityCap)

		for (const [normalizedName, list] of kept) {
			const entityId = `entity:${normalizedName}`
			const mentions = list.reduce((s, r) => s + r.mentionCount, 0)
			pushNode(nodes, {
				id: entityId,
				kind: 'entity',
				label: list[0].name,
				sublabel: role.replace(/_/g, ' '),
				role,
				normalizedName,
				mentionCount: mentions,
				documentCount: new Set(list.map((r) => r.documentId)).size,
				weight: 1 + Math.min(2, mentions / 8),
			})
			pushEdge(edges, { source: roleId, target: entityId, kind: 'has_entity' })

			for (const row of list) {
				const docId = `doc:${row.documentId}`
				pushNode(nodes, {
					id: docId,
					kind: 'document',
					label: row.filename ?? `DOC-${row.documentId}`,
					sublabel: (row.documentType ?? '').replace(/_/g, ' '),
					documentType: row.documentType,
					documentId: row.documentId,
					caseId: row.caseId ?? undefined,
					weight: 2,
				})
				pushEdge(edges, { source: entityId, target: docId, kind: 'mentioned_in' })

				if (row.caseId != null) {
					const cId = `case:${row.caseId}`
					pushNode(nodes, {
						id: cId,
						kind: 'case',
						label: row.caseNumber ?? `CASE-${row.caseId}`,
						weight: 3,
						caseId: row.caseId,
					})
					pushEdge(edges, { source: docId, target: cId, kind: 'in_case' })
					pushEdge(edges, { source: cId, target: roleId, kind: 'has_role' })
				}
			}
		}

		return {
			focusId: roleId,
			focusType: 'role',
			caseId: caseId ?? ranked[0]?.[1][0]?.caseId ?? 0,
			caseNumber: '',
			title: role.replace(/_/g, ' '),
			caseType: '',
			status: '',
			nodes,
			edges,
			totals: {
				entities: byEntity.size,
				roles: 1,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: nodes.filter((n) => n.kind === 'case').length,
				links: edges.length,
				hiddenEntities: Math.max(0, byEntity.size - kept.length),
			},
		}
	}

}
