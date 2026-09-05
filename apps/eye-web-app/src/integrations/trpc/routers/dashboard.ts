import { apiClient } from "#/lib/api-client";
import { createTRPCRouter, publicProcedure } from "../init";

interface DocumentStats {
	total: number;
	pending: number;
	processing: number;
	completed: number;
	failed: number;
}

interface CoOccurrenceNetwork {
	nodes: Array<{
		normalizedName: string;
		displayName: string;
		role: string;
		connections: number;
	}>;
	edges: Array<{
		source: string;
		target: string;
		weight: number;
	}>;
}

export const dashboardRouter = createTRPCRouter({
	entities: publicProcedure.query(async () => {
		const result = await apiClient.get<{ data: CoOccurrenceNetwork }>(
			"/entities/network?limit=12",
		);
		const nodes = result?.data?.nodes ?? [];
		return nodes.slice(0, 6).map((n, i) => ({
			id: i + 1,
			name: n.displayName,
			normalizedName: n.normalizedName,
			role: n.role || "unknown",
			connections: n.connections || 0,
			caseNumber: null as string | null,
		}));
	}),

	entityNetwork: publicProcedure.query(async () => {
		const result = await apiClient.get<{ data: CoOccurrenceNetwork }>(
			"/entities/network?limit=30",
		);
		return result?.data ?? { nodes: [], edges: [] };
	}),

	stats: publicProcedure.query(async () => {
		return apiClient.get<DocumentStats>("/documents/stats");
	}),
});
