import { describe, expect, test } from "vitest";
import {
	formatBytes,
	getUploadExtension,
	isSupportedUploadFile,
	jobProgress,
	jobStatusChipVariant,
	normalizeCollectionInput,
	validateCollection,
	validateSourceRoot,
	DEFAULT_COLLECTION,
} from "./ingestion-helpers";

describe("validateSourceRoot — source-link validation", () => {
	test("rejects empty / whitespace-only links (no empty-job POST)", () => {
		expect(validateSourceRoot("local-fs", "")).toMatch(/required/);
		expect(validateSourceRoot("s3", "   ")).toMatch(/required/);
	});

	test("rejects unknown source kinds instead of misrouting", () => {
		expect(validateSourceRoot("gdrive", "folder-123")).toMatch(
			/Unsupported source/,
		);
	});

	test("local paths must be absolute (catches cwd-dependent ingest)", () => {
		expect(validateSourceRoot("local-fs", "relative/path")).toMatch(/absolute/);
		expect(validateSourceRoot("local-fs", "/data/judgments")).toBeNull();
	});

	test("leading/trailing whitespace is tolerated, not rejected", () => {
		expect(validateSourceRoot("local-fs", "  /data/x  ")).toBeNull();
	});

	test("s3 accepts s3:// and bare bucket/prefix forms", () => {
		expect(validateSourceRoot("s3", "s3://bucket/prefix")).toBeNull();
		expect(validateSourceRoot("s3", "bucket/prefix")).toBeNull();
	});

	test("s3 rejects bare fragments that would list the whole account", () => {
		expect(validateSourceRoot("s3", "ab")).toMatch(/S3 link/);
		expect(validateSourceRoot("s3", "x")).toMatch(/S3 link/);
	});
});

describe("jobProgress — WeightBar fraction", () => {
	test("fresh job with zero total files reports 0, never NaN", () => {
		const value = jobProgress({
			status: "pending",
			totalFiles: 0,
			doneFiles: 0,
			failedFiles: 0,
		});
		expect(value).toBe(0);
		expect(Number.isNaN(value)).toBe(false);
	});

	test("counts failed files as settled (bar completes on partial failure)", () => {
		expect(
			jobProgress({
				status: "partial",
				totalFiles: 4,
				doneFiles: 3,
				failedFiles: 1,
			}),
		).toBe(1);
	});

	test("partial progress is exact (catches done/total off-by-one)", () => {
		expect(
			jobProgress({
				status: "processing",
				totalFiles: 4,
				doneFiles: 1,
				failedFiles: 0,
			}),
		).toBe(0.25);
	});

	test("clamps over-reported counts to 1 (no bar overflow)", () => {
		expect(
			jobProgress({
				status: "done",
				totalFiles: 2,
				doneFiles: 5,
				failedFiles: 0,
			}),
		).toBe(1);
	});

	test("clamps negative counts to 0", () => {
		expect(
			jobProgress({
				status: "failed",
				totalFiles: 2,
				doneFiles: -1,
				failedFiles: 0,
			}),
		).toBe(0);
	});
});

describe("jobStatusChipVariant — status mapping", () => {
	test("terminal states map to success / error", () => {
		expect(jobStatusChipVariant("done")).toBe("success");
		expect(jobStatusChipVariant("failed")).toBe("error");
	});

	test("partial is a warning, not an error (still needs attention)", () => {
		expect(jobStatusChipVariant("partial")).toBe("warning");
	});

	test("in-flight states share the active variant", () => {
		for (const s of ["processing", "transferring", "discovering"]) {
			expect(jobStatusChipVariant(s)).toBe("default");
		}
	});

	test("unknown future backend states degrade to muted instead of crashing", () => {
		expect(jobStatusChipVariant("quarantined")).toBe("muted");
		expect(jobStatusChipVariant("")).toBe("muted");
	});
});

describe("formatBytes — human sizes", () => {
	test("boundary formatting at 1023/1024", () => {
		expect(formatBytes(1023)).toBe("1023 B");
		expect(formatBytes(1024)).toBe("1.0 KB");
	});

	test("megabyte and gigabyte ranges", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
	});

	test("negative and non-finite input never leaks into the UI", () => {
		expect(formatBytes(-5)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
	});
});

describe("isSupportedUploadFile — backend allowlist mirror", () => {
	test("extension check is case-insensitive (catches .PDF rejection)", () => {
		expect(isSupportedUploadFile("PLEADING.PDF")).toBe(true);
		expect(isSupportedUploadFile("scan.TIFF")).toBe(true);
	});

	test("unsupported types are rejected client-side before the POST", () => {
		expect(isSupportedUploadFile("notes.txt")).toBe(false);
		expect(isSupportedUploadFile("archive.zip")).toBe(false);
		expect(isSupportedUploadFile("noextension")).toBe(false);
	});

	test("getUploadExtension lowercases and handles dotfiles", () => {
		expect(getUploadExtension("a.PDF")).toBe("pdf");
		expect(getUploadExtension("noext")).toBe("");
	});
});

describe("collection — judgments default, any folder allowed", () => {
	test("empty input falls back to judgments (default collection)", () => {
		expect(DEFAULT_COLLECTION).toBe("judgments");
		expect(normalizeCollectionInput("")).toBe("judgments");
		expect(normalizeCollectionInput("   ")).toBe("judgments");
		expect(validateCollection("")).toBeNull();
	});

	test("custom collections normalize to lowercase", () => {
		expect(normalizeCollectionInput("Contracts")).toBe("contracts");
		expect(normalizeCollectionInput("  police-reports  ")).toBe(
			"police-reports",
		);
		expect(validateCollection("contracts")).toBeNull();
	});

	test("traversal and separators are rejected (no key-escape via collection)", () => {
		for (const bad of ["../evil", "a/b", "a\\b", "x".repeat(65)]) {
			expect(() => normalizeCollectionInput(bad)).toThrow(/Invalid collection/);
			expect(validateCollection(bad)).toMatch(/Invalid collection/);
		}
	});
});
