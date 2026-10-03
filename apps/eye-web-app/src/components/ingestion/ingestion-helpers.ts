export type IngestionSource = "local-fs" | "s3";

export const DEFAULT_COLLECTION = "judgments";

/** Normalize a collection name; empty falls back to judgments. Throws on unsafe input. */
export function normalizeCollectionInput(input: string): string {
	const collection = input.trim().toLowerCase() || DEFAULT_COLLECTION;
	if (!/^[a-z0-9-]{1,64}$/.test(collection)) {
		throw new Error(`Invalid collection: ${input}`);
	}
	return collection;
}

/** Returns an error message, or null when the collection is valid. */
export function validateCollection(input: string): string | null {
	try {
		normalizeCollectionInput(input);
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : "Invalid collection";
	}
}

export interface JobProgressInput {
	status: string;
	totalFiles: number;
	doneFiles: number;
	failedFiles: number;
}

const SUPPORTED_UPLOAD_EXTENSIONS = new Set([
	"pdf",
	"png",
	"jpg",
	"jpeg",
	"tiff",
	"tif",
	"bmp",
]);

export const UPLOAD_ACCEPT_ATTR = ".pdf,.png,.jpg,.jpeg,.tiff,.tif,.bmp";

/** Returns an error message, or null when the source link is valid. */
export function validateSourceRoot(
	source: string,
	root: string,
): string | null {
	const trimmed = root.trim();
	if (trimmed.length === 0) return "Source link is required";
	if (source !== "local-fs" && source !== "s3") {
		return `Unsupported source: ${source}`;
	}
	if (source === "local-fs") {
		if (!trimmed.startsWith("/")) {
			return "Local path must be absolute (e.g. /data/judgments)";
		}
		return null;
	}
	const bare = trimmed.startsWith("s3://") ? trimmed.slice(5) : trimmed;
	if (bare.length < 3 || (!bare.includes("/") && !bare.includes("."))) {
		return "S3 link must be s3://bucket/prefix or bucket/prefix";
	}
	return null;
}

/** 0..1 fraction for WeightBar. Never NaN — a fresh job reports 0. */
export function jobProgress(job: JobProgressInput): number {
	if (job.totalFiles <= 0) return 0;
	const settled = job.doneFiles + job.failedFiles;
	const fraction = settled / job.totalFiles;
	if (!Number.isFinite(fraction)) return 0;
	return Math.max(0, Math.min(1, fraction));
}

export type JobChipVariant =
	| "default"
	| "success"
	| "warning"
	| "error"
	| "secondary"
	| "muted";

/** Exhaustive status → chip mapping; unknown backend states degrade to muted. */
export function jobStatusChipVariant(status: string): JobChipVariant {
	switch (status) {
		case "done":
			return "success";
		case "failed":
			return "error";
		case "partial":
			return "warning";
		case "processing":
		case "transferring":
		case "discovering":
			return "default";
		case "pending":
			return "secondary";
		default:
			return "muted";
	}
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getUploadExtension(filename: string): string {
	const idx = filename.lastIndexOf(".");
	if (idx < 0) return "";
	return filename.slice(idx + 1).toLowerCase();
}

/** Mirrors the backend allowlist so the UI never accepts a file the API rejects. */
export function isSupportedUploadFile(filename: string): boolean {
	return SUPPORTED_UPLOAD_EXTENSIONS.has(getUploadExtension(filename));
}
