import { Elysia, t } from 'elysia'
import { eq } from 'drizzle-orm'
import {
	caseRepository,
	documentRepository,
	caseRelationRepository,
	cases,
} from '@workspace/shared'
import crypto from 'crypto'
import { CasesService } from './service'
import { ChunksService } from '../internal/chunks/service'

function generateCaseNumber(): string {
	const hex = crypto.randomBytes(3).toString('hex').toUpperCase()
	return `CASE-${hex}`
}

export const casesRouter = new Elysia({ prefix: '/cases' })
	.post(
		'/',
		async ({ body }) => {
			try {
				const caseNumber = generateCaseNumber()
				const doc = await caseRepository.create({
					caseNumber,
					title: body.title,
					description: body.description ?? null,
					caseType: body.caseType,
					parties: body.parties ?? null,
					tags: body.tags ?? null,
					status: 'active',
				})

				return { success: true, case: doc }
			} catch (error) {
				console.error('Case creation error:', error)
				return { error: String(error) }
			}
		},
		{
			body: t.Object({
				title: t.String(),
				caseType: t.String({ description: 'litigation | contract | investigation | other' }),
				description: t.Optional(t.String()),
				parties: t.Optional(t.Array(t.String())),
				tags: t.Optional(t.Array(t.String())),
			}),
		},
	)
	.get(
		'/',
		async ({ query }) => {
			try {
				const conditions: any[] = []
				if (query.status) {
					conditions.push(eq(cases.status, query.status))
				}
				const result = await caseRepository.findMany(conditions, {
					limit: query.limit ?? 100,
					orderField: 'createdAt',
					orderBy: 'desc',
				})
				return result.data
			} catch (error) {
				console.error('Case listing error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				status: t.Optional(t.String()),
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 100 })),
			}),
		},
	)
	.get(
		'/:id',
		async ({ params, set }) => {
			try {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const c = await caseRepository.findById(id)
				if (!c) {
					set.status = 404
					return { error: 'Case not found' }
				}
				const docs = await documentRepository.findByCaseId(id)
				return { ...c, documents: docs }
			} catch (error) {
				console.error('Case fetch error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/documents',
		async ({ params, set }) => {
			try {
				const id = Number(params.id)
				if (Number.isNaN(id)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const docs = await documentRepository.findByCaseId(id)
				return docs
			} catch (error) {
				console.error('Case documents error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/entity-contexts',
		async ({ params, query, set }) => {
			try {
				const caseId = Number(params.id)
				const normalizedName = query.name
				if (Number.isNaN(caseId) || !normalizedName) {
					set.status = 400
					return { error: 'Invalid case id or entity name' }
				}
				const contexts = await CasesService.getEntityMentionContexts(
					normalizedName,
					caseId,
					150,
					query.mentionIndex,
				)
				return { data: contexts }
			} catch (error) {
				console.error('Entity mention contexts error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				name: t.String(),
				mentionIndex: t.Optional(t.Numeric()),
			}),
		},
	)
	.post(
		'/:id/participants',
		async ({ params, body, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const participant = await CasesService.addManualParticipant(caseId, {
					name: body.name,
					role: body.role,
					documentId: body.documentId,
				})
				return { data: participant }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (message === 'Case has no documents' || message === 'Document is not in this case') {
					set.status = 400
					return { error: message }
				}
				console.error('Add participant error:', error)
				set.status = 500
				return { error: message }
			}
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1 }),
				role: t.Optional(t.String()),
				documentId: t.Optional(t.Numeric()),
			}),
		},
	)
	.get(
		'/:id/entities',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const result = await CasesService.getCaseEntities(caseId)
				return { data: result }
			} catch (error) {
				console.error('Case entities error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/chronology',
		async ({ params, query, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const page = await CasesService.getDocumentChronology(caseId, {
					maxDates: query.limit,
				})
				return {
					data: page.events,
					totalDates: page.totalDates,
					totalEvents: page.totalEvents,
				}
			} catch (error) {
				console.error('Case chronology error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
			}),
		},
	)
	.get(
		'/:id/reference-links',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const links = await CasesService.getReferenceLinks(caseId)
				return { data: links }
			} catch (error) {
				console.error('Case reference links error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/network',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const found = await caseRepository.findById(caseId)
				if (!found) {
					set.status = 404
					return { error: 'Case not found' }
				}
				const network = await CasesService.getCaseNetwork(caseId)
				const caseNumber = found.caseNumber || network.caseNumber
				return {
					data: {
						...network,
						title: found.title,
						caseType: found.caseType,
						status: found.status,
						caseNumber,
						nodes: network.nodes.map((n) =>
							n.id === `case:${caseId}`
								? { ...n, label: caseNumber, sublabel: found.title }
								: n,
						),
					},
				}
			} catch (error) {
				console.error('Case network error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/graph',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const graph = await CasesService.getDocumentGraph(caseId)
				return { data: graph }
			} catch (error) {
				console.error('Case graph error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/intelligence',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const found = await caseRepository.findById(caseId)
				if (!found) {
					set.status = 404
					return { error: 'Case not found' }
				}
				const graph = await CasesService.getIntelligenceGraph(caseId)
				return {
					data: {
						...graph,
						title: found.title,
						caseType: found.caseType,
						status: found.status,
						caseNumber: found.caseNumber || graph.caseNumber,
						nodes: graph.nodes.map((n) =>
							n.id === `case:${caseId}`
								? { ...n, label: found.caseNumber, sublabel: found.title }
								: n,
						),
					},
				}
			} catch (error) {
				console.error('Case intelligence error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/role-flags',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const flags = await CasesService.getRoleVarianceFlags(caseId)
				return { data: flags }
			} catch (error) {
				console.error('Case role flags error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/trajectories',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const trajectories = await CasesService.getEntityTrajectories(caseId)
				return { data: trajectories }
			} catch (error) {
				console.error('Case trajectories error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/chunks',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const chunks = await CasesService.getCaseChunks(caseId)
				return { data: chunks }
			} catch (error) {
				console.error('Case chunks error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/relations',
		async ({ params, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}
				const relations = await caseRelationRepository.findRelationsForCaseWithDetails(caseId)
				const related = relations.map((r) => ({
					relationType: r.relation.relationType,
					entityName: r.relation.entityName,
					strength: r.relation.strength,
					metadata: r.relation.metadata,
					case: r.relatedCase,
				}))
				return { data: related }
			} catch (error) {
				console.error('Case relations error:', error)
				return { error: String(error) }
			}
		},
	)
	.get(
		'/:id/similar-cases',
		async ({ params, query, set }) => {
			try {
				const caseId = Number(params.id)
				if (Number.isNaN(caseId)) {
					set.status = 400
					return { error: 'Invalid case id' }
				}

				const docs = await documentRepository.findByCaseId(caseId)
				const processedDoc = docs.find(
					(d) => d.status === 'completed' || d.status === 'processed',
				)
				if (!processedDoc) {
					return { similarCases: [] }
				}

				const result = await ChunksService.getSimilar(processedDoc.id, {
					limit: query.limit ?? 10,
					alpha: query.alpha ?? 0.4,
					beta: query.beta ?? 0.4,
					gamma: query.gamma ?? 0,
				})

				if (!result || result.similarCases.length === 0) {
					return { similarCases: [] }
				}

				const docIds = result.similarCases.map((sc) => sc.caseId)
				const docsByDocId = new Map<number, { caseId: number | null }>()
				await Promise.all(
					docIds.map(async (docId) => {
						const d = await documentRepository.findById(docId)
						docsByDocId.set(docId, { caseId: d?.caseId ?? null })
					}),
				)

				const seen = new Set<number>()
				const caseIdsToFetch = new Set<number>()
				const resolved: typeof result.similarCases = []

				for (const sc of result.similarCases) {
					const actualCaseId = docsByDocId.get(sc.caseId)?.caseId ?? sc.caseId
					if (actualCaseId === caseId) continue
					if (seen.has(actualCaseId)) continue
					seen.add(actualCaseId)
					caseIdsToFetch.add(actualCaseId)
					resolved.push({ ...sc, caseId: actualCaseId })
				}

				const caseMeta = new Map<number, { title: string; documentCount: number }>()
				await Promise.all(
					Array.from(caseIdsToFetch).map(async (cid) => {
						const [c, docs] = await Promise.all([
							caseRepository.findById(cid),
							documentRepository.findByCaseId(cid),
						])
						caseMeta.set(cid, {
							title: c?.title ?? '',
							documentCount: docs.length,
						})
					}),
				)

				const enriched = resolved.map((sc) => {
					const meta = caseMeta.get(sc.caseId)
					return {
						...sc,
						title: meta?.title ?? '',
						documentCount: meta?.documentCount ?? 0,
					}
				})

				return { similarCases: enriched }
			} catch (error) {
				console.error('Similar cases error:', error)
				return { error: String(error) }
			}
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 10 })),
				alpha: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0.4 })),
				beta: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0.4 })),
				gamma: t.Optional(t.Numeric({ minimum: 0, maximum: 1, default: 0 })),
			}),
		},
	)
