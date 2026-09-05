const API_URL = process.env.API_URL || "http://api:3001";

class ApiClientError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.name = "ApiClientError";
	}
}

class ApiClientImpl {
	private baseUrl: string;

	constructor(baseUrl: string = API_URL) {
		this.baseUrl = baseUrl;
	}

	private async request<T>(
		path: string,
		options: RequestInit = {},
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			...options,
			headers: {
				...options.headers,
			},
		});

		if (!response.ok) {
			const body = await response.text();
			throw new ApiClientError(response.status, `API error ${response.status}: ${body}`);
		}

		return response.json() as Promise<T>;
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>(path, {
			method: "POST",
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
		});
	}

	async postFormData<T>(path: string, formData: FormData): Promise<T> {
		return this.request<T>(path, {
			method: "POST",
			body: formData,
		});
	}

	async get<T>(path: string): Promise<T> {
		return this.request<T>(path, { method: "GET" });
	}
}

export { ApiClientError };
export const apiClient = new ApiClientImpl();
