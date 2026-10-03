import { z } from "zod";
import { apiClient } from "#/lib/api-client";
import { createTRPCRouter, protectedProcedure } from "../init";

export const ingestionSourceSchema = z.enum(["local-fs", "s3"]);

export interface IngestionJobData {
	id: string;
	source: string;
	root: string;
	collection: string;
	status: string;
	totalFiles: number;
	doneFiles: number;
	failedFiles: number;
	totalBytes: number;
	transferredBytes: number;
	createdAt: string;
	updatedAt: string;
	lastError: string | null;
}

export interface IngestionFileData {
	id: string;
	jobId: string;
	source: string;
	sourceKey: string;
	relativePath: string;
	filename: string;
	sizeBytes: number;
	checksum: string;
	storageKey: string | null;
	status: string;
	attempts: number;
	lastError: string | null;
	bytesTransferred: number;
}

export interface QueueStatusData {
	collection: string;
	queue: string;
	counts: {
		waiting: number;
		active: number;
		completed: number;
		failed: number;
		delayed: number;
	};
}

export const ingestionRouter = createTRPCRouter({
	list: protectedProcedure.query(async () => {
		const result = await apiClient.get<{ data: IngestionJobData[] }>(
			"/ingestion/jobs",
		);
		return result?.data ?? [];
	}),

	queueStatus: protectedProcedure.query(async () => {
		const result = await apiClient.get<{ data: QueueStatusData[] }>(
			"/ingestion/queues/status",
		);
		return result?.data ?? [];
	}),

	getById: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{ data: IngestionJobData }>(
				`/ingestion/jobs/${encodeURIComponent(input.id)}`,
			);
			return result?.data ?? null;
		}),

	listFiles: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.query(async ({ input }) => {
			const result = await apiClient.get<{
				data: IngestionFileData[];
				pagination: { limit: number; offset: number; total: number };
			}>(`/ingestion/jobs/${encodeURIComponent(input.id)}/files?limit=200`);
			return result?.data ?? [];
		}),

	create: protectedProcedure
		.input(
			z.object({
				source: ingestionSourceSchema,
				root: z.string().min(1, "Source link is required").max(1024),
				collection: z
					.string()
					.regex(/^[a-z0-9-]{1,64}$/i, "Invalid collection")
					.optional(),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await apiClient.post<{ data: IngestionJobData }>(
				"/ingestion/jobs",
				input.collection ? input : { source: input.source, root: input.root },
			);
			return result?.data;
		}),

	enqueue: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const result = await apiClient.post<{
				data: { jobId: string; enqueued: number; failed: number };
			}>(`/ingestion/jobs/${encodeURIComponent(input.id)}/enqueue`, {});
			return result?.data ?? { jobId: input.id, enqueued: 0, failed: 0 };
		}),
});
