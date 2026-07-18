import { Link, useNavigate } from "@tanstack/react-router";
import {
	Button,
	Form,
	FormControl,
	FormField,
	FormLabel,
	getErrorMessage,
	HudDialog,
	InputField,
	StatusDot,
} from "@workspace/ui";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { EntitySearchDialog } from "#/components/case-detail";

const caseFormSchema = z.object({
	title: z.string().min(1, "Title is required").max(255),
	caseType: z.string().min(1, "Case type is required"),
	description: z.string().max(1000).optional(),
	parties: z.string().optional(),
	tags: z.string().optional(),
});

function NewCaseDialog({
	open,
	onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
	const trpc = useTRPC();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [error, setError] = useState<string | null>(null);

	const createMutation = useMutation({
		...trpc.cases.create.mutationOptions(),
		onSuccess: (data) => {
			queryClient.invalidateQueries(trpc.cases.list.queryOptions());
			onOpenChange(false);
			if (data?.case?.id) {
				navigate({ to: "/cases/$caseId", params: { caseId: String(data.case.id) } });
			}
		},
		onError: (err) => {
			console.error('Failed to create case:', err);
			setError(err instanceof Error ? err.message : "Failed to create case");
		},
	});

	const form = useForm({
		defaultValues: {
			title: "",
			caseType: "litigation",
			description: "",
			parties: "",
			tags: "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			await createMutation.mutateAsync({
				title: value.title,
				caseType: value.caseType,
				description: value.description || undefined,
				parties: value.parties
					? value.parties.split(",").map((p) => p.trim()).filter(Boolean)
					: undefined,
				tags: value.tags
					? value.tags.split(",").map((t) => t.trim()).filter(Boolean)
					: undefined,
			});
		},
	});

	return (
		<HudDialog
			open={open}
			onOpenChange={onOpenChange}
			title="NEW_CASE"
			variant="form"
			size="lg"
			primaryActionLabel="CREATE_CASE"
			onPrimaryAction={() => form.handleSubmit()}
			loading={createMutation.isPending}
		>
			<Form form={form} className="space-y-4" onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}>
				{error && (
					<div className="border border-destructive/30 bg-destructive/5 p-2 flex items-center gap-2">
						<StatusDot variant="error" size="sm" />
						<span className="font-mono text-body text-destructive/70">{error}</span>
					</div>
				)}

				<FormField
					name="title"
					validators={{ onChange: caseFormSchema.shape.title }}
				>
					<FormLabel>TITLE</FormLabel>
					<FormControl>
						{(field) => {
							const err = getErrorMessage(field.state.meta.errors[0]);
							return (
								<InputField
									type="text"
									required
									placeholder="e.g. Smith vs State"
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
					name="caseType"
					validators={{ onChange: caseFormSchema.shape.caseType }}
				>
					<FormLabel>CASE_TYPE</FormLabel>
					<FormControl>
						{(field) => {
							const err = getErrorMessage(field.state.meta.errors[0]);
							return (
								<select
									className={`w-full bg-surface border ${err ? "border-destructive/50" : "border-outline"} text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50 transition-colors`}
									value={field.state.value as string}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								>
									<option value="litigation">Litigation</option>
									<option value="contract">Contract</option>
									<option value="investigation">Investigation</option>
									<option value="other">Other</option>
								</select>
							);
						}}
					</FormControl>
				</FormField>

				<FormField
					name="description"
					validators={{ onChange: caseFormSchema.shape.description }}
				>
					<FormLabel>DESCRIPTION</FormLabel>
					<FormControl>
						{(field) => {
							const err = getErrorMessage(field.state.meta.errors[0]);
							return (
								<InputField
									type="text"
									placeholder="Brief description of this case..."
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
					name="parties"
					validators={{ onChange: caseFormSchema.shape.parties }}
				>
					<FormLabel>PARTIES (COMMA)</FormLabel>
					<FormControl>
						{(field) => {
							const err = getErrorMessage(field.state.meta.errors[0]);
							return (
								<InputField
									type="text"
									placeholder="e.g. John Doe, Jane Corp"
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
					name="tags"
					validators={{ onChange: caseFormSchema.shape.tags }}
				>
					<FormLabel>TAGS (COMMA)</FormLabel>
					<FormControl>
						{(field) => {
							const err = getErrorMessage(field.state.meta.errors[0]);
							return (
								<InputField
									type="text"
									placeholder="e.g. urgent, criminal, appeal"
									value={field.state.value as string}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									{...(err ? { error: err } : {})}
								/>
							);
						}}
					</FormControl>
				</FormField>
			</Form>
		</HudDialog>
	);
}

const NAV_ITEMS = [
	{ label: "DASHBOARD", to: "/", active: true },
	{ label: "INTELLIGENCE", to: "#", active: false },
	{ label: "NETWORK", to: "#", active: false },
	{ label: "ARCHIVE", to: "#", active: false },
	{ label: "SYSTEM", to: "#", active: false },
] as const;

function LatencyReadout() {
	const [latency, setLatency] = useState(12);

	useEffect(() => {
		const interval = setInterval(() => {
			setLatency(Math.floor(8 + Math.random() * 10));
		}, 3000);
		return () => clearInterval(interval);
	}, []);

	return (
		<div className="flex items-center gap-1.5">
			<StatusDot variant="success" size="sm" pulse />
			<span className="font-mono text-body tabular-nums text-outline">
				{latency}ms
			</span>
		</div>
	);
}

function UserMenu() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);

	if (!session?.user) return null;

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 hover:text-primary transition-colors"
			>
				<span className="material-symbols-outlined text-base text-outline">
					account_circle
				</span>
				<span className="hidden lg:block font-mono text-body uppercase tracking-wider text-on-surface-variant">
					{session.user.name?.toUpperCase() || "OPERATIVE"}
				</span>
				<span className="material-symbols-outlined text-xs text-outline">
					expand_more
				</span>
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div className="absolute right-0 top-full mt-1 z-50 w-48 border border-outline/40 bg-surface-container-high backdrop-blur-xl">
						<div className="px-3 py-2 border-b border-outline-variant/20">
							<p className="font-mono text-body uppercase tracking-wider text-primary/60">
								{session.user.name || "Operative"}
							</p>
							<p className="font-mono text-body text-outline mt-0.5">
								{session.user.email}
							</p>
						</div>
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								navigate({ to: "/profile" });
							}}
							className="w-full px-3 py-2 text-left font-mono text-body uppercase tracking-wider text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-colors"
						>
							PROFILE
						</button>
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								void authClient
									.signOut()
									.then(() => navigate({ to: "/auth/login" }));
							}}
							className="w-full px-3 py-2 text-left font-mono text-body uppercase tracking-wider text-outline hover:text-destructive hover:bg-destructive/5 transition-colors"
						>
							DISCONNECT
						</button>
					</div>
				</>
			)}
		</div>
	);
}

export function AppShell({ children }: { children: React.ReactNode }) {
	const [newCaseOpen, setNewCaseOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();

	useEffect(() => {
		if (isPending) return;
		if (!session) {
			sessionStorage.setItem("redirectTo", window.location.pathname);
			navigate({ to: "/auth/login" });
		}
	}, [session, isPending, navigate]);

	if (isPending) {
		return (
			<div className="relative min-h-screen bg-background text-foreground overflow-hidden">
				<div className="flex items-center justify-center min-h-screen">
					<StatusDot variant="muted" size="lg" pulse />
					<span className="font-mono text-body text-outline ml-3">
						AUTHENTICATING...
					</span>
				</div>
			</div>
		);
	}

	if (!session) return null;

	return (
		<div className="relative min-h-screen bg-background text-foreground overflow-hidden">
			{/* Top Nav Bar - HUD Chrome */}
			<nav className="fixed top-0 left-0 right-0 z-50 h-12 bg-surface/95 backdrop-blur-xl border-b border-primary/20 flex items-center px-4">
				{/* Brand */}
				<div className="flex items-center gap-6 mr-6">
					<span className="font-mono text-sm font-bold tracking-widest text-primary">
						THE_EYE
					</span>
					<span className="hidden xl:block font-mono text-body uppercase tracking-[0.15em] text-outline">
						TACTICAL_INTELLIGENCE_HUD
					</span>
				</div>

				{/* Nav Items */}
				<div className="hidden md:flex items-center gap-1">
					{NAV_ITEMS.map((item) => (
						<Link
							key={item.label}
							to={item.to}
							className={`px-3 py-1.5 font-mono text-body uppercase tracking-wider transition-colors ${
								item.active
									? "text-primary border-b border-primary"
									: "text-outline hover:text-on-surface-variant"
							}`}
						>
							{item.label}
						</Link>
					))}
				</div>

				{/* Mobile nav toggle */}
				<button
					type="button"
					className="md:hidden ml-1 material-symbols-outlined text-outline text-lg"
				>
					menu
				</button>

				{/* Right Cluster */}
				<div className="flex items-center gap-4 ml-auto">
					<Button
						variant="ghost"
						size="sm"
						className="hidden sm:inline-flex"
						onClick={() => setSearchOpen(true)}
					>
						SEARCH
					</Button>

					<Button
						variant="default"
						size="sm"
						className="hidden sm:inline-flex"
						onClick={() => setNewCaseOpen(true)}
					>
						NEW_OP
					</Button>

					<LatencyReadout />

					<div className="hidden sm:flex items-center gap-3">
						<span className="material-symbols-outlined text-sm text-outline hover:text-on-surface-variant cursor-pointer transition-colors">
							settings
						</span>
						<span className="material-symbols-outlined text-sm text-outline hover:text-on-surface-variant cursor-pointer transition-colors relative">
							notifications
							<span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
						</span>
					</div>

					<UserMenu />
				</div>
			</nav>

			{/* Content */}
			<div className="pt-12">{children}</div>

			{/* Footer Chrome */}
			<footer className="h-8 bg-surface/95 backdrop-blur-xl border-t border-primary/20 flex items-center justify-between px-4">
				<div className="flex items-center gap-3">
					<span className="font-mono text-meta uppercase tracking-widest text-outline">
						&copy; THE_EYE
					</span>
					<span className="font-mono text-meta uppercase tracking-widest text-outline">
						//
					</span>
					<span className="font-mono text-meta uppercase tracking-widest text-outline">
						CLASSIFIED
					</span>
					<span className="font-mono text-meta uppercase tracking-widest text-outline">
						//
					</span>
					<span className="font-mono text-meta uppercase tracking-widest text-outline">
						LEVEL_7_AUTH_REQUIRED
					</span>
				</div>
				<div className="hidden sm:flex items-center gap-4">
					<span className="font-mono text-meta uppercase tracking-wider text-outline hover:text-on-surface-variant cursor-pointer transition-colors">
						TERMS_OF_ENGAGEMENT
					</span>
					<span className="font-mono text-meta uppercase tracking-wider text-outline hover:text-on-surface-variant cursor-pointer transition-colors">
						PRIVACY_DIRECTIVE
					</span>
				</div>
			</footer>

			<NewCaseDialog open={newCaseOpen} onOpenChange={setNewCaseOpen} />
			<EntitySearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
		</div>
	);
}
