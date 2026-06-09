import { apiKeyUsages, type ApiKeyUsage } from "../schemas";
import { BaseRepository } from "./base";

export class ApiKeyUsageRepository extends BaseRepository<ApiKeyUsage> {
	constructor() {
		super(apiKeyUsages);
	}

	async recordUsage(apiKeyId: number, service: string, endpoint: string, method: string, statusCode: number, responseTime: number, success: boolean, bytesProcessed: number, creditsUsed: number): Promise<ApiKeyUsage> {
		const result = await this.create({
			apiKeyId,
			service,
			endpoint,
			method,
			statusCode,
			responseTime,
			success,
			bytesProcessed,
			creditsUsed,
			ipAddress: '127.0.0.1',
			timestamp: new Date(),
		})
		return result
	}
}
