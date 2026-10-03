import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HudDialog, InputField, StatusDot } from "@workspace/ui";
import { useState } from "react";
import { useTRPC } from "#/integrations/trpc/react";
import {
	DEFAULT_COLLECTION,
	type IngestionSource,
	normalizeCollectionInput,
	validateCollection,
	validateSourceRoot,
} from "./ingestion-helpers";

export function NewIngestionDialog({
	open,
	onOpenChange,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated?: (jobId: string) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [source, setSource] = useState<IngestionSource>("local-fs");
	const [root, setRoot] = useState("");
	const [collection, setCollection] = useState(DEFAULT_COLLECTION);
	const [error, setError] = useState<string | null>(null);

	const createMutation = useMutation({
		...trpc.ingestion.create.mutationOptions(),
		onSuccess: (job) => {
			queryClient.invalidateQueries({
				queryKey: trpc.ingestion.list.queryKey(),
			});
			setRoot("");
			setCollection(DEFAULT_COLLECTION);
			setError(null);
			onOpenChange(false);
			if (job?.id) onCreated?.(job.id);
		},
		onError: (err) => {
			setError(
				err instanceof Error ? err.message : "Failed to start ingestion",
			);
		},
	});

	const validationError =
		root.length > 0 ? validateSourceRoot(source, root) : null;

	const handleSubmit = async () => {
		const invalid =
			validateSourceRoot(source, root) ?? validateCollection(collection);
		if (invalid) {
			setError(invalid);
			return;
		}
		setError(null);
		await createMutation.mutateAsync({
			source,
			root: root.trim(),
			collection: normalizeCollectionInput(collection),
		});
	};

	return (
		<HudDialog
			open={open}
			onOpenChange={onOpenChange}
			title="NEW_INGESTION"
			variant="form"
			size="sm"
			primaryActionLabel="START_INGEST"
			onPrimaryAction={handleSubmit}
			loading={createMutation.isPending}
		>
			<div className="space-y-4">
				{error && (
					<div className="border border-destructive/30 bg-destructive/5 p-2 flex items-center gap-2">
						<StatusDot variant="error" size="sm" />
						<span className="font-mono text-body text-destructive/70">
							{error}
						</span>
					</div>
				)}

				<div>
					<label
						htmlFor="ingest-source"
						className="font-mono text-body uppercase tracking-[0.12em] text-on-surface-variant block mb-1.5"
					>
						SOURCE
					</label>
					<select
						id="ingest-source"
						className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors"
						value={source}
						onChange={(e) => {
							setSource(e.target.value as IngestionSource);
							setError(null);
						}}
					>
						<option value="local-fs">Local directory</option>
						<option value="s3">S3 prefix</option>
					</select>
				</div>

				<InputField
					label={source === "s3" ? "S3_LINK" : "DIRECTORY_PATH"}
					type="text"
					required
					placeholder={
						source === "s3" ? "s3://bucket/judgments/2024" : "/data/judgments"
					}
					value={root}
					onChange={(e) => {
						setRoot(e.target.value);
						setError(null);
					}}
					{...(validationError ? { error: validationError } : {})}
				/>

				<InputField
					label="COLLECTION"
					type="text"
					required
					placeholder="judgments"
					value={collection}
					onChange={(e) => {
						setCollection(e.target.value);
						setError(null);
					}}
					{...(collection.length > 0 && validateCollection(collection)
						? { error: validateCollection(collection) as string }
						: {})}
				/>

				<p className="font-mono text-meta text-outline">
					{source === "s3"
						? "RECURSIVE_LIST_OF_THE_PREFIX._HIERARCHY_PRESERVED."
						: "RECURSIVE_WALK_OF_THE_DIRECTORY._SYMLINKS_SKIPPED."}
				</p>
			</div>
		</HudDialog>
	);
}
