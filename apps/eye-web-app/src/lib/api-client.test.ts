import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiClientError, createApiClient, joinUrl } from "./api-client";

function mockFetchOnce(status: number, body: unknown) {
	const seen: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			seen.push({ url, init });
			return {
				ok: status >= 200 && status < 300,
				status,
				text: async () =>
					typeof body === "string" ? body : JSON.stringify(body),
				json: async () => body,
			} as Response;
		}),
	);
	return seen;
}

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.API_SERVICE_TOKEN;
	delete process.env.COREF_SERVICE_TOKEN;
	delete process.env.API_URL;
});

describe("joinUrl — slash handling", () => {
	test("trailing-slash base + leading-slash path yields one slash (no // 404)", () => {
		expect(joinUrl("http://localhost:3001/", "/ingestion/jobs")).toBe(
			"http://localhost:3001/ingestion/jobs",
		);
	});

	test("absolute paths pass through untouched", () => {
		expect(joinUrl("http://x", "https://api/y")).toBe("https://api/y");
	});

	test("empty base returns the path as-is (same-origin BFF calls)", () => {
		expect(joinUrl("", "/api/upload/queue")).toBe("/api/upload/queue");
	});
});

describe("credential chain — x-api-key", () => {
	test("server env API_SERVICE_TOKEN is attached (BFF → API auth)", async () => {
		process.env.API_SERVICE_TOKEN = "service-token-abc";
		const seen = mockFetchOnce(200, { data: [] });
		const client = createApiClient({ baseUrl: "http://api:3001" });

		await client.get("/ingestion/jobs");

		expect((seen[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(
			"service-token-abc",
		);
	});

	test("API_SERVICE_TOKEN beats COREF_SERVICE_TOKEN (deterministic precedence)", async () => {
		process.env.API_SERVICE_TOKEN = "primary";
		process.env.COREF_SERVICE_TOKEN = "fallback";
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001" });

		await client.get("/x");

		expect((seen[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(
			"primary",
		);
	});

	test("COREF_SERVICE_TOKEN is the fallback when API_SERVICE_TOKEN is unset", async () => {
		process.env.COREF_SERVICE_TOKEN = "coref-only";
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001" });

		await client.get("/x");

		expect((seen[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(
			"coref-only",
		);
	});

	test("per-request apiKey beats env (no silent wrong-credential bug)", async () => {
		process.env.API_SERVICE_TOKEN = "env-key";
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001" });

		await client.get("/x", { apiKey: "explicit-key" });

		expect((seen[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(
			"explicit-key",
		);
	});

	test("caller-supplied x-api-key header is never clobbered", async () => {
		process.env.API_SERVICE_TOKEN = "env-key";
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001" });

		await client.get("/x", { headers: { "x-api-key": "caller-key" } });

		expect((seen[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(
			"caller-key",
		);
	});

	test("no header is sent when no credential resolves (open local-dev routes)", async () => {
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001" });

		await client.get("/x");

		expect(
			"x-api-key" in ((seen[0]?.init.headers as Record<string, string>) ?? {}),
		).toBe(false);
	});
});

describe("request semantics", () => {
	test("caller headers are merged, not replaced (auth + content-type coexist)", async () => {
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001", apiKey: "k" });

		await client.get("/x", { headers: { Accept: "application/json" } });

		const headers = seen[0]?.init.headers as Record<string, string>;
		expect(headers.Accept).toBe("application/json");
		expect(headers["x-api-key"]).toBe("k");
	});

	test("postFormData never sets Content-Type (runtime multipart boundary survives)", async () => {
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://api:3001", apiKey: "k" });

		await client.postFormData("/upload", new FormData());

		const headers = seen[0]?.init.headers as Record<string, string>;
		expect("Content-Type" in headers).toBe(false);
		expect(headers["x-api-key"]).toBe("k");
	});

	test("403 message points at the missing credential and never leaks the key", async () => {
		mockFetchOnce(403, "Missing API key");
		const client = createApiClient({
			baseUrl: "http://api:3001",
			apiKey: "TOPSECRETKEY",
		});

		const err = await client.get("/x").catch((e) => e);
		expect(err).toBeInstanceOf(ApiClientError);
		expect((err as ApiClientError).status).toBe(403);
		expect((err as Error).message).toMatch(/x-api-key/);
		expect((err as Error).message).not.toContain("TOPSECRETKEY");
	});

	test("server base URL defaults to localhost:3001 without API_URL", async () => {
		const seen = mockFetchOnce(200, {});
		const client = createApiClient();

		await client.get("/health");

		expect(seen[0]?.url).toBe("http://localhost:3001/health");
	});
});
