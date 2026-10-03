import { createFileRoute } from "@tanstack/react-router";
import { StatusDot } from "@workspace/ui";
import { AppShell } from "#/components/app-shell";
import { IngestionPanel } from "#/components/ingestion/ingestion-panel";

export const Route = createFileRoute("/ingestion")({
	component: IngestionPage,
});

function IngestionPage() {
	return (
		<AppShell>
			<div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-4">
				<div className="flex items-center gap-2">
					<StatusDot variant="default" size="sm" pulse />
					<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
						INGESTION_OPS
					</span>
					<span className="font-mono text-meta text-outline">
						{"//"} FILE_UPLOADS_AND_SOURCE_LINKS
					</span>
				</div>
				<IngestionPanel />
			</div>
		</AppShell>
	);
}
