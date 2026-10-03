import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";

async function handler({
	request,
	params,
}: {
	request: Request;
	params: { jobId: string };
}) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	const jobId = params.jobId;
	if (!jobId) {
		return new Response(JSON.stringify({ error: "Missing job id" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	const apiUrl = process.env.API_URL || "http://localhost:3001";
	const serviceToken =
		process.env.API_SERVICE_TOKEN || process.env.COREF_SERVICE_TOKEN || "";
	const incoming = new URL(request.url);
	const upstreamUrl = new URL(
		`${apiUrl}/ingestion/jobs/${encodeURIComponent(jobId)}/events`,
	);
	const after = incoming.searchParams.get("after");
	if (after) upstreamUrl.searchParams.set("after", after);

	const upstream = await fetch(upstreamUrl, {
		method: "GET",
		headers: {
			Accept: "text/event-stream",
			...(serviceToken ? { "x-api-key": serviceToken } : {}),
		},
	});

	if (!upstream.ok || !upstream.body) {
		const body = upstream.body ? await upstream.text() : "Upstream error";
		return new Response(
			JSON.stringify({
				error: body.slice(0, 300) || `Upstream error ${upstream.status}`,
			}),
			{
				status: upstream.status,
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	return new Response(upstream.body, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}

export const Route = createFileRoute("/api/ingestion/$jobId/events")({
	server: {
		handlers: {
			GET: handler,
		},
	},
});
