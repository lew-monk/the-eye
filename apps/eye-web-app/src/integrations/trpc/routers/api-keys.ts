import { z } from "zod";
import { apiClient } from "#/lib/api-client";
import { createTRPCRouter, protectedProcedure } from "../init";

const permissionSchema = z.object({
	service: z.string(),
	resource: z.string(),
	actions: z.array(z.string()),
});

const createKeySchema = z.object({
	name: z.string().min(1).max(100),
	permission: z.array(permissionSchema).min(1),
	scopes: z.array(z.string()).optional(),
	expiresAt: z.string().optional(),
});

export interface ApiKeyListItem {
	id: number;
	name: string;
	keyPrefix: string;
	permission: { service: string; resource: string; actions: string[] }[];
	scopes: string[] | null;
	isActive: boolean;
	lastUsedAt: string | null;
	expiresAt: string;
}

export const apiKeysRouter = createTRPCRouter({
	create: protectedProcedure
		.input(createKeySchema)
		.mutation(async ({ ctx, input }) => {
			const body = {
				userId: ctx.user.id,
				name: input.name,
				permission: input.permission,
				scopes: input.scopes ?? [],
				rateLimit: null,
				expiresAt:
					input.expiresAt ??
					new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
			};

			const result = await apiClient.post<{
				success: boolean;
				rawKey: string;
				apiKey: {
					id: number;
					name: string;
					keyPrefix: string;
					permission: typeof input.permission;
					isActive: boolean;
					expiresAt: string;
				};
			}>("/admin/api-keys", body);

			return result;
		}),

	list: protectedProcedure.query(async ({ ctx }) => {
		const result = await apiClient.get<ApiKeyListItem[] | { error: string }>(
			`/admin/api-keys?userId=${encodeURIComponent(ctx.user.id)}`,
		);
		if (!Array.isArray(result)) {
			console.error("Failed to list API keys:", (result as { error: string }).error);
			return [];
		}
		return result;
	}),

	revoke: protectedProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			const result = await apiClient.post<{
				success: boolean;
			}>("/admin/api-keys/revoke", {
				userId: ctx.user.id,
				id: input.id,
			});
			return result;
		}),
});
