import { documentRepository, participantRepository } from '@workspace/shared'
import { ChronologyService } from './chronology'
import { GraphService } from './graph'
import { pushEdge, pushNode } from './network-helpers'
import type {
	CaseNetwork,
	CaseNetworkEdge,
	CaseNetworkNode,
	EntityTrajectory,
	EntityTrajectoryPoint,
	RoleVarianceFlag,
} from './types'

export abstract class CaseIntelligenceService {
	static async getRoleVarianceFlags(caseId: number): Promise<RoleVarianceFlag[]> {
		const docs = await documentRepository.findByCaseId(caseId)
		const byName = new Map<
			string,
			{
				displayName: string
				roles: Map<string, Set<number>>
			}
		>()

		for (const doc of docs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const entry = byName.get(p.normalizedName) ?? {
					displayName: p.name,
					roles: new Map(),
				}
				const role = p.role || 'other'
				const docsForRole = entry.roles.get(role) ?? new Set()
				docsForRole.add(doc.id)
				entry.roles.set(role, docsForRole)
				byName.set(p.normalizedName, entry)
			}
		}

		const flags: RoleVarianceFlag[] = []
		for (const [normalizedName, entry] of byName) {
			if (entry.roles.size < 2) continue

			const roles = [...entry.roles.entries()]
				.map(([role, documentIds]) => ({
					role,
					documentIds: [...documentIds],
					count: documentIds.size,
				}))
				.sort((a, b) => b.count - a.count)

			const primary = roles[0]
			const outliers = roles.slice(1)
			flags.push({
				normalizedName,
				displayName: entry.displayName,
				roles,
				primaryRole: primary.role,
				flag: `Role varies: primary "${primary.role}" (${primary.count} docs); also ${outliers
					.map((o) => `"${o.role}" (${o.count})`)
					.join(', ')}`,
			})
		}

		flags.sort((a, b) => b.roles.length - a.roles.length || a.normalizedName.localeCompare(b.normalizedName))
		return flags
	}

	static async getEntityTrajectories(caseId: number): Promise<EntityTrajectory[]> {
		const docs = await documentRepository.findByCaseId(caseId)
		const chronology = (await ChronologyService.getDocumentChronology(caseId)).events
		const dateByDoc = new Map<number, string>()
		for (const e of chronology) {
			const prev = dateByDoc.get(e.documentId)
			if (!prev || e.date < prev) dateByDoc.set(e.documentId, e.date)
		}

		// Sort docs by extracted date then id
		const orderedDocs = [...docs].sort((a, b) => {
			const da = dateByDoc.get(a.id) ?? ''
			const db = dateByDoc.get(b.id) ?? ''
			if (da && db && da !== db) return da.localeCompare(db)
			if (da && !db) return -1
			if (!da && db) return 1
			return a.id - b.id
		})

		const byName = new Map<string, EntityTrajectory>()

		for (const doc of orderedDocs) {
			const parts = await participantRepository.findByDocumentId(doc.id)
			for (const p of parts) {
				const traj = byName.get(p.normalizedName) ?? {
					normalizedName: p.normalizedName,
					displayName: p.name,
					points: [],
				}
				traj.points.push({
					documentId: doc.id,
					filename: doc.filename,
					documentType: doc.documentType,
					date: dateByDoc.get(doc.id) ?? null,
					mentionCount: p.mentionCount ?? 0,
					role: p.role,
				})
				byName.set(p.normalizedName, traj)
			}
		}

		return [...byName.values()]
			.filter((t) => t.points.length >= 1)
			.sort((a, b) => {
				const sumA = a.points.reduce((s, p) => s + p.mentionCount, 0)
				const sumB = b.points.reduce((s, p) => s + p.mentionCount, 0)
				return sumB - sumA
			})
	}

	static classifyTrajectory(
		points: { mentionCount: number }[],
	): { trend: 'surge' | 'drop' | 'stable' | 'single'; label: string; delta: number } {
		if (points.length < 2) return { trend: 'single', label: 'FIRST_SEEN', delta: 0 }
		const first = points[0].mentionCount
		const last = points[points.length - 1].mentionCount
		const delta = last - first
		const base = Math.max(first, 1)
		const pct = Math.round((delta / base) * 100)
		if (delta >= Math.max(2, Math.ceil(base * 0.25))) {
			return { trend: 'surge', label: pct > 0 ? `SURGE +${pct}%` : 'SURGE', delta }
		}
		if (delta <= -Math.max(2, Math.ceil(base * 0.25))) {
			return { trend: 'drop', label: `DROP ${pct}%`, delta }
		}
		return { trend: 'stable', label: 'STABLE', delta }
	}

	static async getIntelligenceGraph(caseId: number): Promise<CaseNetwork> {
		const docs = await documentRepository.findByCaseId(caseId)
		const flags = await CaseIntelligenceService.getRoleVarianceFlags(caseId)
		const trajectories = await CaseIntelligenceService.getEntityTrajectories(caseId)
		const links = await GraphService.getReferenceLinks(caseId)

		const nodes: CaseNetworkNode[] = []
		const edges: CaseNetworkEdge[] = []
		const caseNodeId = `case:${caseId}`
		const caseNumber = docs[0]?.caseNumber ?? `CASE-${caseId}`

		pushNode(nodes, {
			id: caseNodeId,
			kind: 'case',
			label: caseNumber,
			weight: 4,
			caseId,
			documentCount: docs.length,
		})

		const docById = new Map(docs.map((d) => [d.id, d]))

		const addDoc = (documentId: number) => {
			const doc = docById.get(documentId)
			if (!doc) return
			const id = `doc:${doc.id}`
			pushNode(nodes, {
				id,
				kind: 'document',
				label: doc.filename,
				sublabel: doc.documentType?.replace(/_/g, ' '),
				documentType: doc.documentType,
				documentId: doc.id,
				caseId,
				weight: 1.6,
			})
			pushEdge(edges, { source: caseNodeId, target: id, kind: 'has_document' })
		}

		const addEntity = (normalizedName: string, displayName: string, role?: string) => {
			const id = `entity:${normalizedName}`
			pushNode(nodes, {
				id,
				kind: 'entity',
				label: displayName,
				sublabel: role?.replace(/_/g, ' '),
				role,
				normalizedName,
				weight: 2.2,
			})
			return id
		}

		for (const flag of flags.slice(0, 12)) {
			const entityId = addEntity(flag.normalizedName, flag.displayName, flag.primaryRole)
			const signalId = `signal:variance:${flag.normalizedName}`
			pushNode(nodes, {
				id: signalId,
				kind: 'signal',
				label: 'ROLE VARIES',
				sublabel: flag.primaryRole.replace(/_/g, ' '),
				signal: 'role_variance',
				detail: flag.flag,
				normalizedName: flag.normalizedName,
				role: flag.primaryRole,
				weight: 2.4,
			})
			pushEdge(edges, { source: caseNodeId, target: signalId, kind: 'has_signal' })
			pushEdge(edges, { source: signalId, target: entityId, kind: 'about' })
			for (const r of flag.roles) {
				for (const documentId of r.documentIds.slice(0, 3)) addDoc(documentId)
			}
		}

		let surgeCount = 0
		let dropCount = 0
		for (const traj of trajectories) {
			const { trend, label } = CaseIntelligenceService.classifyTrajectory(traj.points)
			if (trend !== 'surge' && trend !== 'drop') continue
			if (trend === 'surge' && surgeCount >= 8) continue
			if (trend === 'drop' && dropCount >= 8) continue
			if (trend === 'surge') surgeCount += 1
			else dropCount += 1

			const entityId = addEntity(
				traj.normalizedName,
				traj.displayName,
				traj.points[traj.points.length - 1]?.role,
			)
			const signalId = `signal:${trend}:${traj.normalizedName}`
			pushNode(nodes, {
				id: signalId,
				kind: 'signal',
				label,
				sublabel: traj.displayName,
				signal: trend,
				detail: `${traj.displayName} mention ${trend} across ${traj.points.length} documents.`,
				normalizedName: traj.normalizedName,
				mentionCount: traj.points.reduce((s, p) => s + p.mentionCount, 0),
				weight: 2.6,
			})
			pushEdge(edges, { source: caseNodeId, target: signalId, kind: 'has_signal' })
			pushEdge(edges, { source: signalId, target: entityId, kind: 'about' })
			const last = traj.points[traj.points.length - 1]
			const first = traj.points[0]
			if (first) addDoc(first.documentId)
			if (last) addDoc(last.documentId)
		}

		let unresolvedCount = 0
		for (const link of links) {
			if (link.attachedTo) continue
			if (unresolvedCount >= 10) break
			unresolvedCount += 1
			const signalId = `signal:unresolved:${link.documentId}:${link.start}`
			pushNode(nodes, {
				id: signalId,
				kind: 'signal',
				label: link.reference.slice(0, 28),
				sublabel: 'UNRESOLVED',
				signal: 'unresolved',
				detail: link.evidence || `Unattached reference “${link.reference}” in ${link.filename}.`,
				documentId: link.documentId,
				weight: 1.8,
			})
			pushEdge(edges, { source: caseNodeId, target: signalId, kind: 'has_signal' })
			addDoc(link.documentId)
			pushEdge(edges, {
				source: signalId,
				target: `doc:${link.documentId}`,
				kind: 'about',
				label: link.reference,
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
				entities: nodes.filter((n) => n.kind === 'entity').length,
				roles: nodes.filter((n) => n.kind === 'signal').length,
				documents: nodes.filter((n) => n.kind === 'document').length,
				cases: 1,
				links: edges.length,
				hiddenEntities: 0,
			},
		}
	}

}
