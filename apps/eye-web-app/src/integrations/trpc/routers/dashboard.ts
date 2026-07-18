import { apiClient } from "#/lib/api-client";
import { createTRPCRouter, publicProcedure } from "../init";

interface ParticipantResult {
	data: Array<{
		id: number;
		name: string;
		normalizedName: string;
		role: string;
		mentionCount: number;
		caseNumber: string | null;
	}>;
	total: number;
}

interface DocumentStats {
	total: number;
	pending: number;
	processing: number;
	completed: number;
	failed: number;
}

export const dashboardRouter = createTRPCRouter({
	entities: publicProcedure.query(async () => {
		const result = await apiClient.get<ParticipantResult>(
			"/participants?limit=6",
		);
		return result.data.map((p) => ({
			id: p.id,
			name: p.name,
			normalizedName: p.normalizedName,
			role: p.role || "unknown",
			connections: p.mentionCount || 0,
			caseNumber: p.caseNumber,
		}));
	}),

	stats: publicProcedure.query(async () => {
		return apiClient.get<DocumentStats>("/documents/stats");
	}),
});
