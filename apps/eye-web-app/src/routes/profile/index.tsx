import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Button,
	Form,
	FormControl,
	FormField,
	FormLabel,
	getErrorMessage,
	GlassPanel,
	HudDialog,
	InputField,
	StatusDot,
} from "@workspace/ui";
import { useState } from "react";
import { z } from "zod";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/profile/")({ component: ApiKeys });

const apiKeySchema = z.object({
	name: z.string().min(1, "Key name is required").max(100),
	service: z.string().min(1, "Service is required"),
	resource: z.string().min(1, "Resource is required"),
	actions: z.string().min(1, "Actions are required"),
});

function maskKey(prefix: string): string {
	return `${prefix}${"*".repeat(24)}`;
}

function formatDate(date: string | null): string {
	if (!date) return "—";
	return new Date(date).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function ApiKeys() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [revealedKey, setRevealedKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [revokeTarget, setRevokeTarget] = useState<{ id: number; name: string } | null>(null);

	const queryResult = useQuery(trpc.apiKeys.list.queryOptions());
	const apiKeys = Array.isArray(queryResult.data) ? queryResult.data : [];
	const isLoading = queryResult.isLoading;

	if (queryResult.error) {
		console.error("Failed to load API keys:", queryResult.error);
	}

	const createMutation = useMutation({
		...trpc.apiKeys.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries(trpc.apiKeys.list.queryOptions());
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Failed to create API key");
		},
	});

	const revokeMutation = useMutation({
		...trpc.apiKeys.revoke.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries(trpc.apiKeys.list.queryOptions());
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Failed to revoke API key");
		},
	});

	const form = useForm({
		defaultValues: {
			name: "",
			service: "api",
			resource: "documents",
			actions: "read,create",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const data = await createMutation.mutateAsync({
					name: value.name,
					scopes: undefined,
					permission: [
						{
							service: value.service,
							resource: value.resource,
							actions: value.actions
								.split(",")
								.map((a) => a.trim())
								.filter(Boolean),
						},
					],
				});
				setRevealedKey(data.rawKey);
				form.reset();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Unknown error");
			}
		},
	});

	return (
		<div className="space-y-4">
			{error && (
				<div className="border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-2">
					<StatusDot variant="error" size="sm" />
					<span className="font-mono text-body text-destructive/70">
						{error}
					</span>
					<button
						type="button"
						className="ml-auto font-mono text-body text-destructive/40"
						onClick={() => setError(null)}
					>
						DISMISS
					</button>
				</div>
			)}

			{revealedKey && (
				<GlassPanel variant="default" brackets="both" padding="md">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<StatusDot variant="success" size="sm" pulse />
							<span className="font-mono text-body uppercase tracking-[0.15em] text-primary/60">
								KEY_GENERATED
							</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setRevealedKey(null)}
						>
							DISMISS
						</Button>
					</div>
					<div className="bg-surface/50 border border-primary/20 p-3">
						<span className="font-mono text-body text-outline block mb-1">
							RAW_API_KEY (SAVE_IT_NOW)
						</span>
						<code className="font-mono text-xs text-primary/80 break-all">
							{revealedKey}
						</code>
					</div>
				</GlassPanel>
			)}

			<GlassPanel variant="default" brackets="both" padding="md">
				<div className="flex items-center gap-2 mb-4">
					<StatusDot variant="default" size="sm" pulse />
					<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
						API_KEYS
					</span>
					<span className="font-mono text-body text-outline ml-auto">
						{apiKeys.length} KEY{apiKeys.length !== 1 ? "S" : ""}
					</span>
				</div>

				{isLoading ? (
					<div className="py-8 text-center">
						<StatusDot variant="muted" size="md" pulse />
						<span className="font-mono text-body text-outline ml-2">
							LOADING...
						</span>
					</div>
				) : apiKeys.length === 0 ? (
					<div className="py-8 text-center border border-dashed border-border/30">
						<span className="font-mono text-body text-outline">
							NO_API_KEYS
						</span>
					</div>
				) : (
					<div className="space-y-2">
						{apiKeys.map((key) => (
							<div
								key={key.id}
								className="border border-border/20 bg-surface/30 p-3 flex items-center gap-3 group"
							>
								<StatusDot
									variant={key.isActive ? "success" : "muted"}
									size="sm"
								/>

								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1">
										<span className="font-mono text-body text-on-surface-variant">
											{key.name}
										</span>
										{!key.isActive && (
											<span className="font-mono text-meta text-destructive/60">
												REVOKED
											</span>
										)}
									</div>
									<div className="flex items-center gap-2 text-body text-outline">
										<code className="font-mono">
											{maskKey(key.keyPrefix)}
										</code>
										<span className="text-outline">|</span>
										<span>
											{key.permission
												.map((p) => `${p.service}:${p.resource}`)
												.join(", ")}
										</span>
									</div>
									<div className="flex items-center gap-2 mt-1">
										<span className="font-mono text-meta text-outline">
											EXP: {formatDate(key.expiresAt)}
										</span>
										{key.lastUsedAt && (
											<>
												<span className="text-outline">|</span>
												<span className="font-mono text-meta text-outline">
													LAST: {formatDate(key.lastUsedAt)}
												</span>
											</>
										)}
									</div>
								</div>

								{key.isActive && (
									<Button
										variant="ghost"
										size="sm"
										className="opacity-0 group-hover:opacity-100 transition-opacity"
										onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
									>
										REVOKE
									</Button>
								)}
							</div>
						))}
					</div>
				)}
			</GlassPanel>

			<GlassPanel variant="default" brackets="both" padding="md">
				<div className="flex items-center gap-2 mb-4">
					<StatusDot variant="default" size="sm" pulse />
					<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
						GENERATE_API_KEY
					</span>
				</div>

				<Form form={form} className="space-y-4 grid" onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}>
					<FormField
						name="name"
						validators={{
							onChange: apiKeySchema.shape.name,
						}}
					>
						<FormLabel>KEY_NAME</FormLabel>
						<FormControl>
							{(field) => {
								const err = getErrorMessage(field.state.meta.errors[0]);
								return (
									<InputField
										type="text"
										required
										placeholder="e.g. development-key"
										value={field.state.value as string}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										{...(err ? { error: err } : {})}
									/>
								);
							}}
						</FormControl>
					</FormField>

					<div className="grid grid-cols-1 gap-3">
						<FormField
							name="service"
							validators={{
								onChange: apiKeySchema.shape.service,
							}}
						>
							<FormLabel>SERVICE</FormLabel>
							<FormControl>
								{(field) => {
									const err = getErrorMessage(field.state.meta.errors[0]);
									return (
										<InputField
											type="text"
											placeholder="api"
											value={field.state.value as string}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											{...(err ? { error: err } : {})}
										/>
									);
								}}
							</FormControl>
						</FormField>

						<FormField
							name="resource"
							validators={{
								onChange: apiKeySchema.shape.resource,
							}}
						>
							<FormLabel>RESOURCE</FormLabel>
							<FormControl>
								{(field) => {
									const err = getErrorMessage(field.state.meta.errors[0]);
									return (
										<InputField
											type="text"
											placeholder="documents"
											value={field.state.value as string}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											{...(err ? { error: err } : {})}
										/>
									);
								}}
							</FormControl>
						</FormField>

						<FormField
							name="actions"
							validators={{
								onChange: apiKeySchema.shape.actions,
							}}
						>
							<FormLabel>ACTIONS (COMMA)</FormLabel>
							<FormControl>
								{(field) => {
									const err = getErrorMessage(field.state.meta.errors[0]);
									return (
										<InputField
											type="text"
											placeholder="read,create"
											value={field.state.value as string}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											{...(err ? { error: err } : {})}
										/>
									);
								}}
							</FormControl>
						</FormField>
					</div>

					<form.Subscribe
						selector={(state) => [state.canSubmit, state.isSubmitting]}
					>
						{([canSubmit, isSubmitting]) => (
							<Button
								type="submit"
								variant="default"
								size="sm"
								disabled={!canSubmit || isSubmitting}
							>
								{isSubmitting ? "CREATING..." : "GENERATE_KEY"}
							</Button>
						)}
					</form.Subscribe>
				</Form>
			</GlassPanel>

			<HudDialog
				open={revokeTarget !== null}
				onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}
				title="REVOKE_API_KEY"
				indexCode={revokeTarget ? `KEY_${String(revokeTarget.id).padStart(4, "0")}` : undefined}
				variant="destructive"
				primaryActionLabel="REVOKE_KEY"
				onPrimaryAction={() => {
					if (revokeTarget) {
						revokeMutation.mutate({ id: revokeTarget.id })
						setRevokeTarget(null)
					}
				}}
				size="sm"
			>
				<p>
					This action will permanently revoke the API key{" "}
					<strong className="font-mono text-on-surface">{revokeTarget?.name}</strong>.
				</p>
				<p className="mt-1 text-outline">
					Any services using this key will lose access immediately.
					This cannot be undone.
				</p>
			</HudDialog>
		</div>
	);
}
