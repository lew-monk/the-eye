import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";

async function handler({
	request,
	params,
}: {
	request: Request;
	params: { documentId: string };
}) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	const documentId = params.documentId;
	if (!documentId || Number.isNaN(Number(documentId))) {
		return new Response(JSON.stringify({ error: "Invalid document id" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	const apiUrl = process.env.API_URL || "http://localhost:3001";
	const serviceToken =
		process.env.API_SERVICE_TOKEN || process.env.COREF_SERVICE_TOKEN || "";
	const incoming = new URL(request.url);
	const disposition =
		incoming.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

	const upstreamUrl = new URL(`${apiUrl}/documents/${documentId}/file`);
	upstreamUrl.searchParams.set("disposition", disposition);

	const upstream = await fetch(upstreamUrl, {
		method: "GET",
		headers: {
			Accept: request.headers.get("Accept") || "*/*",
			...(serviceToken ? { "x-api-key": serviceToken } : {}),
		},
	});

	if (!upstream.ok) {
		const body = await upstream.text();
		console.error("Document file proxy failed", {
			documentId,
			status: upstream.status,
			body: body.slice(0, 300),
			hasServiceToken: Boolean(serviceToken),
		});
		return new Response(
			JSON.stringify({
				error:
					upstream.status === 401
						? "File service is not authorized. Set COREF_SERVICE_TOKEN on the web app to match the API."
						: body || `Upstream error ${upstream.status}`,
			}),
			{
				status: upstream.status,
				headers: { "Content-Type": "application/json" },
			},
		);
	}

	const headers = new Headers();
	const contentType = upstream.headers.get("Content-Type");
	const contentDisposition = upstream.headers.get("Content-Disposition");
	const contentLength = upstream.headers.get("Content-Length");
	if (contentType) headers.set("Content-Type", contentType);
	if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
	if (contentLength) headers.set("Content-Length", contentLength);
	headers.set("Cache-Control", "private, max-age=60");
	headers.set("X-Content-Type-Options", "nosniff");

	return new Response(upstream.body, {
		status: upstream.status,
		headers,
	});
}

export const Route = createFileRoute("/api/documents/$documentId/file")({
	server: {
		handlers: {
			GET: handler,
		},
	},
});
