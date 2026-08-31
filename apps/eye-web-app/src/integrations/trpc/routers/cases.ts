import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { apiClient } from "#/lib/api-client";
import { createTRPCRouter, protectedProcedure } from "../init";

export const createCaseSchema = z.object({
	title: z.string().min(1, "Title is required").max(255),
	caseType: z.string().min(1, "Case type is required"),
	description: z.string().max(1000).optional(),
	parties: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
});

export interface CaseData {
	id: number;
	caseNumber: string;
	title: string;
	description: string | null;
	caseType: string;
	status: string;
	parties: string[] | null;
	tags: string[] | null;
	metadata: unknown;
	createdAt: string;
	updatedAt: string;
	documents?: DocumentData[];
}

export interface DocumentData {
	id: number;
	filename: string;
	fileType: string;
	fileSize: number;
	documentType: string;
	caseNumber: string | null;
	caseId: number | null;
	status: string;
	storageKey?: string | null;
	contentType?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UploadResult {
	success: boolean;
	documentId: number;
	processingTimeMs: number;
	message: string;
}

export interface SimilarCaseResult {
	caseId: number;
	caseNumber: string;
	title: string;
	documentCount: number;
	documentType: string;
	score: number;
	breakdown: {
		entityOverlap: number;
		embeddingCos: number | null;
		metadataScore: number;
	};
	reasons: string[];
}

export interface EntitySearchResult {
	id: number;
	documentId: number;
	name: string;
	normalizedName: string;
	role: string;
	roleConfidence: number | null;
	entityType: string | null;
	mentionCount: number | null;
	mentions: string[] | null;
	clusterId: number | null;
	relevanceScore: number | null;
	extractionVersion: number | null;
	caseId: number | null;
	caseNumber: string | null;
	documentType: string;
}

export interface CaseRelationData {
	relationType: string;
	entityName: string | null;
	strength: number | null;
	metadata: unknown;
	case: {
		id: number;
		caseNumber: string;
		title: string;
		description: string | null;
		caseType: string;
		status: string;
		parties: string[] | null;
		tags: string[] | null;
		metadata: unknown;
		createdAt: string;
		updatedAt: string;
	};
}

export interface EntityRoleBreakdown {
	role: string;
	count: number;
	confidence: number;
}

export interface EntityConfidence {
	score: number;
	roleConsistency: number;
	documentCoverage: number;
	flags: string[];
	roleBreakdown: EntityRoleBreakdown[];
}

export interface ParticipantEntity {
	id: number;
	name: string;
	normalizedName: string;
	role: string;
	roleConfidence: number | null;
	mentionCount: number;
	relevanceScore: number | null;
	mentions: string[] | null;
	documentCount: number;
	totalDocsInCase?: number;
	confidence?: EntityConfidence;
}

export interface ChunkData {
	id: number;
	documentId: number;
	chunkIndex: number;
	text: string;
	positionWeight: number | null;
	tokenCount: number | null;
}

export interface CaseChunkData {
	id: number;
	documentId: number;
	filename: string;
	chunkIndex: number;
	text: string;
	positionWeight: number | null;
}

export interface MentionContext {
	text: string;
	start: number;
	end: number;
	context: string;
	documentId?: number;
	filename?: string;
}

export interface MentionContextItem {
	participantId: number;
	documentId: number;
	participantName: string;
	allMentions: string[];
	caseId: number | null;
	caseNumber: string | null;
	filename: string;
	mentions: MentionContext[];
}

export interface EntityDossierData {
	normalizedName: string;
	displayName: string;
	totalMentions: number;
	totalDocuments: number;
	totalCases: number;
	roleDistribution: { role: string; count: number; percentage: number }[];
	primaryRole: string;
	appearances: {
		participantId: number;
		documentId: number;
		filename: string;
		caseId: number | null;
		caseNumber: string | null;
		documentType: string;
		role: string;
		roleConfidence: number | null;
		mentionCount: number;
		relevanceScore: number | null;
		mentions: string[] | null;
		clusterId: number | null;
	}[];
	coOccurringEntities: {
		normalizedName: string;
		displayName: string;
		docCount: number;
		roles: string[];
	}[];
	mentionContexts: MentionContextItem[];
	confidence: {
		overallScore: number;
		roleConsistency: number;
		documentCoverage: number;
		roles: { role: string; count: number; documents: number }[];
		flags: string[];
	};
}

export interface ChronologyEvent {
	id: string;
	documentId: number;
	filename: string;
	documentType: string;
	date: string;
	dateSource: string;
	kind: string;
	quote: string | null;
	summary?: string;
	entities: {
		normalizedName: string;
		name: string;
		role: string;
		mentionCount: number;
	}[];
	unresolvedRefs: string[];
}

export interface ChronologyPage {
	events: ChronologyEvent[];
	totalDates: number;
	totalEvents: number;
}

export interface ReferenceLink {
	reference: string;
	attachedTo: string | null;
	attachedName: string | null;
	evidence: string;
	confidence: number;
	documentId: number;
	filename: string;
}

export interface DocumentGraphData {
	nodes: {
		documentId: number;
		filename: string;
		documentType: string;
		dates?: { date: string; kind: string }[];
	}[];
	edges: {
		sourceDocumentId: number;
		targetDocumentId: number;
		relationType: "explicit_reference" | "implicit_subset";
		label: string;
	}[];
}

export type CaseNetworkNodeKind =
	| "case"
	| "document"
	| "entity"
	| "role"
	| "signal"
	| "similar_case";
export type IntelligenceSignalType =
	| "role_variance"
	| "surge"
	| "drop"
	| "unresolved"
	| "similar";
export type NetworkFocusType = "case" | "entity" | "document" | "role";

export type CaseNetworkEdgeKind =
	| "has_document"
	| "has_role"
	| "has_entity"
	| "mentioned_in"
	| "doc_ref"
	| "in_case"
	| "co_occurs"
	| "connected_case"
	| "has_signal"
	| "about"
	| "similar_to";

export interface CaseNetworkNode {
	id: string;
	kind: CaseNetworkNodeKind | "connected_case";
	label: string;
	sublabel?: string;
	role?: string;
	weight: number;
	mentionCount?: number;
	documentCount?: number;
	documentType?: string;
	caseId?: number;
	documentId?: number;
	normalizedName?: string;
	signal?: IntelligenceSignalType;
	detail?: string;
}

export interface CaseNetworkEdge {
	source: string;
	target: string;
	kind: CaseNetworkEdgeKind;
	label?: string;
}

export interface CaseNetworkData {
	focusId: string;
	focusType: NetworkFocusType;
	caseId: number;
	caseNumber: string;
	title: string;
	caseType: string;
	status: string;
	nodes: CaseNetworkNode[];
	edges: CaseNetworkEdge[];
	totals: {
		entities: number;
		roles: number;
		documents: number;
		cases: number;
		links: number;
		hiddenEntities: number;
	};
}

export interface RoleVarianceFlag {
	normalizedName: string;
	displayName: string;
	roles: { role: string; documentIds: number[]; count: number }[];
	primaryRole: string;
	flag: string;
}

export interface EntityTrajectory {
	normalizedName: string;
	displayName: string;
	points: {
		documentId: number;
		filename: string;
		documentType: string;
		date: string | null;
		mentionCount: number;
		role: string;
	}[];
}

export const uploadDocumentSchema = z.object({
	documentType: z.string().min(1, "Document type is required"),
	caseId: z.number(),
});

export const casesRouter = createTRPCRouter({
	create: protectedProcedure
		.input(createCaseSchema)
		.mutation(async ({ input }) => {
			const result = await apiClient.post<{
				success: boolean;
				case: CaseData;
			}>("/cases", input);
			return result;
		}),

	list: protectedProcedure.query(async () => {
		const cases = await apiClient.get<CaseData[]>("/cases");
		return Array.isArray(cases) ? cases : [];
	}),

	getById: protectedProcedure
		.input(z.object({ id: z.number() }))
		.query(async ({ input }) => {
			return apiClient.get<CaseData>(`/cases/${input.id}`);
		}),

	getDocuments: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const docs = await apiClient.get<DocumentData[]>(
				`/cases/${input.caseId}/documents`,
			);
			return Array.isArray(docs) ? docs : [];
		}),

	getParticipants: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: ParticipantEntity[] }>(
				`/cases/${input.caseId}/entities`,
			);
			return result?.data ?? [];
		}),

	getDocumentChunks: protectedProcedure
		.input(z.object({ documentId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: ChunkData[] }>(
				`/documents/${input.documentId}/chunks`,
			);
			return result?.data ?? [];
		}),

	getCaseChunks: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: CaseChunkData[] }>(
				`/cases/${input.caseId}/chunks`,
			);
			return result?.data ?? [];
		}),

	getMentionContexts: protectedProcedure
		.input(z.object({ participantId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: MentionContext[] }>(
				`/participants/${input.participantId}/mention-context`,
			);
			return result?.data ?? [];
		}),

	addParticipant: protectedProcedure
		.input(
			z.object({
				caseId: z.number(),
				name: z.string().min(1),
				role: z.string().optional(),
				documentId: z.number().optional(),
			}),
		)
		.mutation(async ({ input }) => {
			return apiClient.post<{ data: ParticipantEntity }>(
				`/cases/${input.caseId}/participants`,
				{
					name: input.name,
					role: input.role,
					documentId: input.documentId,
				},
			);
		}),

	getEntityMentionContexts: protectedProcedure
		.input(z.object({
			normalizedName: z.string(),
			caseId: z.number(),
			mentionIndex: z.number().optional(),
		}))
		.query(async ({ input }) => {
			const params = new URLSearchParams({ name: input.normalizedName })
			if (input.mentionIndex != null) params.set("mentionIndex", String(input.mentionIndex))
			const result = await apiClient.get<{ data: MentionContext[] }>(
				`/cases/${input.caseId}/entity-contexts?${params.toString()}`,
			);
			return result?.data ?? [];
		}),

	uploadDocument: protectedProcedure
		.input(uploadDocumentSchema)
		.mutation(async ({ ctx, input }) => {
			const formData = ctx.formData;
			if (!formData) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No form data provided",
				});
			}

			formData.set("documentType", input.documentType);
			formData.set("caseId", String(input.caseId));

			return apiClient.postFormData<UploadResult>("/upload", formData);
		}),

	getSimilarCases: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{
				similarCases: SimilarCaseResult[];
			}>(`/cases/${input.caseId}/similar-cases`);
			return result?.similarCases ?? [];
		}),

	entitySearch: protectedProcedure
		.input(
			z.object({
				name: z.string().optional(),
				role: z.string().optional(),
				caseNumber: z.string().optional(),
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
			}),
		)
		.query(async ({ input }) => {
			const params = new URLSearchParams();
			if (input.name) params.set("name", input.name);
			if (input.role) params.set("role", input.role);
			if (input.caseNumber) params.set("caseNumber", input.caseNumber);
			params.set("limit", String(input.limit));
			params.set("offset", String(input.offset));

			return apiClient.get<{
				data: EntitySearchResult[];
				total: number;
			}>(`/participants?${params.toString()}`);
		}),

	getCaseRelations: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: CaseRelationData[] }>(
				`/cases/${input.caseId}/relations`,
			);
			return result?.data ?? [];
		}),

	getEntityDossier: protectedProcedure
		.input(z.object({ normalizedName: z.string() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: EntityDossierData }>(
				`/entities/${encodeURIComponent(input.normalizedName)}/dossier`,
			);
			return result?.data ?? null;
		}),

	getDocumentChronology: protectedProcedure
		.input(
			z.object({
				caseId: z.number(),
				maxDates: z.number().min(1).max(200).optional(),
			}),
		)
		.query(async ({ input }) => {
			const qs = input.maxDates != null ? `?limit=${input.maxDates}` : "";
			const result = await apiClient.get<{
				data: ChronologyEvent[];
				totalDates: number;
				totalEvents: number;
			}>(`/cases/${input.caseId}/chronology${qs}`);
			return {
				events: result?.data ?? [],
				totalDates: result?.totalDates ?? 0,
				totalEvents: result?.totalEvents ?? 0,
			};
		}),

	getReferenceLinks: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: ReferenceLink[] }>(
				`/cases/${input.caseId}/reference-links`,
			);
			return result?.data ?? [];
		}),

	getDocumentGraph: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: DocumentGraphData }>(
				`/cases/${input.caseId}/graph`,
			);
			return result?.data ?? { nodes: [], edges: [] };
		}),

	getCaseNetwork: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: CaseNetworkData }>(
				`/cases/${input.caseId}/network`,
			);
			return result?.data ?? null;
		}),

	getIntelligenceGraph: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: CaseNetworkData }>(
				`/cases/${input.caseId}/intelligence`,
			);
			return result?.data ?? null;
		}),

	getFocusNetwork: protectedProcedure
		.input(
			z.object({
				type: z.enum(["case", "entity", "document", "role"]),
				id: z.string().min(1),
				caseId: z.number().optional(),
			}),
		)
		.query(async ({ input }) => {
			const params = new URLSearchParams({ type: input.type, id: input.id });
			if (input.caseId != null) params.set("caseId", String(input.caseId));
			const result = await apiClient.get<{ data: CaseNetworkData }>(
				`/network/focus?${params.toString()}`,
			);
			return result?.data ?? null;
		}),

	getRoleVarianceFlags: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: RoleVarianceFlag[] }>(
				`/cases/${input.caseId}/role-flags`,
			);
			return result?.data ?? [];
		}),

	getEntityTrajectories: protectedProcedure
		.input(z.object({ caseId: z.number() }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: EntityTrajectory[] }>(
				`/cases/${input.caseId}/trajectories`,
			);
			return result?.data ?? [];
		}),
});
