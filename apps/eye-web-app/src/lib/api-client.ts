/**
 * Universal API client — the single way the web app talks to backends.
 *
 * Isomorphic (server + browser) with one credential chain for `x-api-key`:
 *   1. per-request override (`{ apiKey }`)
 *   2. browser: localStorage `the-eye:api-key` (opt-in via Profile page)
 *   3. server: `API_SERVICE_TOKEN` → `COREF_SERVICE_TOKEN` env
 *
 * Base URL resolution:
 *   - absolute `http...` paths pass through untouched
 *   - explicit `baseUrl` / per-request override wins
 *   - browser: same-origin for `/api/*` (BFF routes), else `VITE_API_URL`
 *   - server: `API_URL`, default `http://localhost:3001`
 *
 * The raw key is never logged and never interpolated into error messages.
 */

const API_KEY_HEADER = "x-api-key";
const BROWSER_KEY_STORAGE = "the-eye:api-key";
const DEFAULT_SERVER_URL = "http://localhost:3001";

export class ApiClientError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.name = "ApiClientError";
	}
}

export interface ApiRequestOptions
	extends Omit<RequestInit, "body" | "headers"> {
	headers?: Record<string, string>;
	/** Per-request credential — beats stored/env keys. */
	apiKey?: string;
	/** Per-request base URL — beats the configured default. */
	baseUrl?: string;
}

interface KeyValueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface ApiClientConfig {
	baseUrl?: string;
	apiKey?: string;
	storage?: KeyValueStorage | null;
}

function isBrowser(): boolean {
	return typeof window !== "undefined" && !!window.localStorage;
}

function readEnv(name: string): string | undefined {
	try {
		if (typeof process !== "undefined" && process.env) {
			const value = process.env[name];
			if (value) return value;
		}
	} catch {
		// process shim without env — fall through
	}
	return undefined;
}

function readViteEnv(name: string): string | undefined {
	try {
		const meta = import.meta as unknown as {
			env?: Record<string, string | undefined>;
		};
		const value = meta.env?.[name];
		if (value) return value;
	} catch {
		// non-vite runtime — fall through
	}
	return undefined;
}

export function joinUrl(base: string, path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	if (!base) return path;
	return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

class ApiClientImpl {
	private baseUrl: string;
	private staticApiKey: string | undefined;
	private storage: KeyValueStorage | null | undefined;

	constructor(config: ApiClientConfig = {}) {
		this.baseUrl = config.baseUrl ?? "";
		this.staticApiKey = config.apiKey;
		this.storage = config.storage;
	}

	private browserStorage(): KeyValueStorage | null {
		if (this.storage !== undefined) return this.storage;
		return isBrowser() ? window.localStorage : null;
	}

	/** Resolve the credential for one request — never throws, never logs. */
	resolveApiKey(override?: string): string | undefined {
		if (override) return override;
		if (this.staticApiKey) return this.staticApiKey;
		const storage = this.browserStorage();
		const stored = storage?.getItem(BROWSER_KEY_STORAGE);
		if (stored) return stored;
		if (!isBrowser()) {
			return readEnv("API_SERVICE_TOKEN") ?? readEnv("COREF_SERVICE_TOKEN");
		}
		return undefined;
	}

	private resolveBaseUrl(path: string, override?: string): string {
		if (/^https?:\/\//i.test(path)) return "";
		if (override) return override;
		if (this.baseUrl) return this.baseUrl;
		if (isBrowser()) {
			if (path.startsWith("/api/")) return "";
			const viteUrl = readViteEnv("VITE_API_URL");
			if (viteUrl) return viteUrl;
			throw new ApiClientError(
				0,
				`No base URL for backend path "${path}" in the browser. Set VITE_API_URL or call the same-origin /api/* BFF route.`,
			);
		}
		return readEnv("API_URL") ?? DEFAULT_SERVER_URL;
	}

	private async request<T>(
		path: string,
		options: ApiRequestOptions = {},
		body?: BodyInit,
	): Promise<T> {
		const base = this.resolveBaseUrl(path, options.baseUrl);
		const url = joinUrl(base, path);
		const apiKey = this.resolveApiKey(options.apiKey);

		const headers: Record<string, string> = { ...options.headers };
		if (apiKey && !headers[API_KEY_HEADER]) {
			headers[API_KEY_HEADER] = apiKey;
		}

		const {
			apiKey: _ignoredKey,
			baseUrl: _ignoredBase,
			headers: _ignoredHeaders,
			...init
		} = options;
		const response = await fetch(url, {
			...init,
			headers,
			...(body !== undefined ? { body } : {}),
		});

		if (!response.ok) {
			const raw = await response.text();
			const hint =
				response.status === 403
					? " (backend requires x-api-key: set API_SERVICE_TOKEN on the web server or save a key via Profile)"
					: "";
			throw new ApiClientError(
				response.status,
				`API error ${response.status}${hint}: ${raw.slice(0, 300)}`,
			);
		}

		return response.json() as Promise<T>;
	}

	async get<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
		return this.request<T>(path, { ...options, method: "GET" });
	}

	async post<T>(
		path: string,
		body: unknown,
		options: ApiRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			path,
			{
				...options,
				method: "POST",
				headers: { "Content-Type": "application/json", ...options.headers },
			},
			JSON.stringify(body),
		);
	}

	async put<T>(
		path: string,
		body: unknown,
		options: ApiRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			path,
			{
				...options,
				method: "PUT",
				headers: { "Content-Type": "application/json", ...options.headers },
			},
			JSON.stringify(body),
		);
	}

	async patch<T>(
		path: string,
		body: unknown,
		options: ApiRequestOptions = {},
	): Promise<T> {
		return this.request<T>(
			path,
			{
				...options,
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...options.headers },
			},
			JSON.stringify(body),
		);
	}

	async del<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
		return this.request<T>(path, { ...options, method: "DELETE" });
	}

	async postFormData<T>(
		path: string,
		formData: FormData,
		options: ApiRequestOptions = {},
	): Promise<T> {
		// Never set Content-Type here — the runtime must generate the
		// multipart boundary, otherwise the upload arrives corrupted.
		const { headers, ...rest } = options;
		return this.request<T>(
			path,
			{ ...rest, method: "POST", headers: headers ? { ...headers } : {} },
			formData,
		);
	}
}

export function createApiClient(config: ApiClientConfig = {}): ApiClientImpl {
	return new ApiClientImpl(config);
}

/** Shared instance — server resolves env, browser resolves localStorage. */
export const apiClient = new ApiClientImpl();

/** Persist a user API key in the browser (opt-in, Profile page). No-op on server. */
export function setBrowserApiKey(rawKey: string): void {
	if (!isBrowser()) return;
	window.localStorage.setItem(BROWSER_KEY_STORAGE, rawKey);
}

export function clearBrowserApiKey(): void {
	if (!isBrowser()) return;
	window.localStorage.removeItem(BROWSER_KEY_STORAGE);
}

export function hasBrowserApiKey(): boolean {
	if (!isBrowser()) return false;
	return window.localStorage.getItem(BROWSER_KEY_STORAGE) != null;
}

export { API_KEY_HEADER };
