/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	clearBrowserApiKey,
	createApiClient,
	hasBrowserApiKey,
	setBrowserApiKey,
} from "./api-client";

function mockFetchOnce(status: number, body: unknown) {
	const seen: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			seen.push({ url, init });
			return {
				ok: status >= 200 && status < 300,
				status,
				text: async () => JSON.stringify(body),
				json: async () => body,
			} as Response;
		}),
	);
	return seen;
}

afterEach(() => {
	vi.unstubAllGlobals();
	window.localStorage.clear();
});

describe("browser credential — localStorage key", () => {
	test("saved browser key is attached to backend calls", async () => {
		setBrowserApiKey("user-key-123");
		expect(hasBrowserApiKey()).toBe(true);
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://localhost:3001" });

		await client.get("/ingestion/jobs");

		expect((seen[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(
			"user-key-123",
		);
	});

	test("clear removes the header (revoked keys stop being sent)", async () => {
		setBrowserApiKey("user-key-123");
		clearBrowserApiKey();
		expect(hasBrowserApiKey()).toBe(false);
		const seen = mockFetchOnce(200, {});
		const client = createApiClient({ baseUrl: "http://localhost:3001" });

		await client.get("/x");

		expect(
			"x-api-key" in ((seen[0]?.init.headers as Record<string, string>) ?? {}),
		).toBe(false);
	});

	test("same-origin /api/* calls go to the BFF without a base URL", async () => {
		const seen = mockFetchOnce(200, {});
		const client = createApiClient();

		await client.postFormData("/api/upload/queue", new FormData());

		expect(seen[0]?.url).toBe("/api/upload/queue");
	});
});
