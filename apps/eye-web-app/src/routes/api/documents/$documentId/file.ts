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
	const upstream = await fetch(`${apiUrl}/documents/${documentId}/file`, {
		method: "GET",
		headers: {
			Accept: request.headers.get("Accept") || "*/*",
		},
	});

	const headers = new Headers();
	const contentType = upstream.headers.get("Content-Type");
	const contentDisposition = upstream.headers.get("Content-Disposition");
	const contentLength = upstream.headers.get("Content-Length");
	if (contentType) headers.set("Content-Type", contentType);
	if (contentDisposition) headers.set("Content-Disposition", contentDisposition);
	if (contentLength) headers.set("Content-Length", contentLength);

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
