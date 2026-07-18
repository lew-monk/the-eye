import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, GlassPanel, StatusChip, StatusDot, EmptyStatePreset } from "@workspace/ui";
import { useEffect, useState } from "react";
import { AppShell } from "#/components/app-shell";
import { useTRPC } from "#/integrations/trpc/react";

export const Route = createFileRoute("/")({ component: Dashboard });

interface DashboardEntity {
	id: number;
	name: string;
	normalizedName: string;
	role: string;
	connections: number;
}

function StatCard({
	label,
	value,
	delta,
	variant = "default",
}: {
	label: string;
	value: string;
	delta?: string;
	variant?: "primary" | "secondary" | "tertiary" | "default";
}) {
	const glow = variant === "primary" || variant === "secondary";

	return (
		<div className="flex flex-col p-4 border-l-2 border-outline-variant/30 hover:border-primary/40 transition-colors duration-500">
			<span className="font-mono text-body uppercase tracking-[0.12em] text-outline">
				{label}
			</span>
			<div className="flex items-baseline gap-2 mt-1.5">
				<span
					className={`font-mono text-2xl font-bold tabular-nums ${glow ? "text-glow-teal text-primary" : "text-on-surface"}`}
				>
					{value}
				</span>
				{delta && (
					<span className="font-mono text-body tabular-nums text-primary">
						{delta}
					</span>
				)}
			</div>
		</div>
	);
}

function EntityRow({
	entity,
	index,
}: {
	entity: DashboardEntity;
	index: number;
}) {
	const roleChipVariant: Record<string, "default" | "secondary" | "muted"> = {
		Judge: "default",
		Counsel: "secondary",
		"Law Enforcement": "secondary",
		Plaintiff: "muted",
		"Expert Witness": "muted",
		Prosecution: "default",
	};

	return (
		<div className="flex items-center justify-between py-1.5 border-b border-outline-variant/10 last:border-0">
			<div className="flex items-center gap-2 min-w-0">
				<span className="font-mono text-body tabular-nums text-outline w-5 shrink-0">
					{String(index + 1).padStart(2, "0")}
				</span>
				<Link
					to="/entities/$entityName"
					params={{ entityName: encodeURIComponent(entity.normalizedName) }}
					className="font-mono text-xs text-on-surface-variant truncate hover:text-primary transition-colors"
				>
					{entity.name}
				</Link>
			</div>
			<div className="flex items-center gap-3 shrink-0">
				<StatusChip variant={roleChipVariant[entity.role] || "muted"} size="sm">
					{entity.role.slice(0, 4).toUpperCase()}
				</StatusChip>
				<span className="font-mono text-body tabular-nums text-outline w-6 text-right">
					{entity.connections}
				</span>
			</div>
		</div>
	);
}

function SystemTelemetry() {
	const [stats, setStats] = useState({
		uptime: 99.97,
		latency: 12,
		nodes: 12,
		throughput: 847,
	});

	useEffect(() => {
		const interval = setInterval(
			() => {
				setStats({
					uptime: +(99.9 + Math.random() * 0.09).toFixed(2),
					latency: Math.floor(8 + Math.random() * 8),
					nodes: Math.floor(10 + Math.random() * 5),
					throughput: Math.floor(800 + Math.random() * 100),
				});
			},
			4000 + Math.random() * 3000,
		);
		return () => clearInterval(interval);
	}, []);

	const telemetry = [
		{ label: "UPTIME", value: `${stats.uptime}%` },
		{ label: "LATENCY", value: `${stats.latency}ms` },
		{ label: "NODES", value: String(stats.nodes) },
		{ label: "OPS/S", value: String(stats.throughput) },
	];

	return (
		<div className="grid grid-cols-2 gap-2">
			{telemetry.map((t) => (
				<div
					key={t.label}
					className="flex flex-col p-2 border border-outline-variant/10"
				>
					<span className="font-mono text-meta uppercase tracking-widest text-outline">
						{t.label}
					</span>
					<span className="font-mono text-sm tabular-nums text-primary/70 mt-0.5">
						{t.value}
					</span>
				</div>
			))}
		</div>
	);
}

function LiveLog() {
	const lines = [
		"> HANDSHAKE_REQUEST_SENT",
		"> ENCRYPTING_SESSION...",
		"> TLS_1.3_NEGOTIATED",
		"> AUTH_TOKEN_VALIDATED",
		"> SECURE_CHANNEL_OPEN",
		"> SCANNING_ENTITIES...",
		"> CROSS_REFERENCING_DOCS",
		"> HUD_RENDER_COMPLETE",
	];
	const [visible, setVisible] = useState<string[]>(lines.slice(0, 4));

	useEffect(() => {
		const interval = setInterval(
			() => {
				setVisible((prev) => {
					const next = [...prev, lines[prev.length % lines.length]];
					if (next.length > 6) next.shift();
					return next;
				});
			},
			2000 + Math.random() * 1500,
		);
		return () => clearInterval(interval);
	}, []);

	return (
		<div className="space-y-1 thin-scrollbar max-h-24 overflow-y-auto">
			{visible.map((line, i) => (
				<div
					key={i}
					className="font-mono text-body text-outline transition-opacity duration-500"
				>
					{line}
				</div>
			))}
		</div>
	);
}

function Dashboard() {
	const trpc = useTRPC();

	const { data: entities = [] } = useQuery({
		...trpc.dashboard.entities.queryOptions(),
		staleTime: 60_000,
	});

	const { data: casesData = [], isLoading } = useQuery({
		...trpc.cases.list.queryOptions(),
		staleTime: 30_000,
	});

	const { data: docStats } = useQuery({
		...trpc.dashboard.stats.queryOptions(),
		staleTime: 60_000,
	});

	const caseCount = casesData.length;
	const activeCount = casesData.filter((c) => c.status === "active").length;
	const documentCount = docStats?.total ?? 0;

	return (
		<AppShell>
			<div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-4">
				{/* Metric Cards - in a bracketed container */}
				<div className="relative bracket-top-left bracket-bottom-right">
					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-x divide-outline-variant/20 border border-outline-variant/30">
						<StatCard
							label="TOTAL_CASES"
							value={String(caseCount)}
							variant="primary"
						/>
						<StatCard label="ACTIVE" value={String(activeCount)} variant="primary" />
						<StatCard label="DOCUMENTS" value={String(documentCount)} variant="secondary" />
						<StatCard label="ENTITIES" value={String(entities.length)} variant="secondary" />
						<StatCard
							label="CONNECTIONS"
							value={String(entities.reduce((sum, e) => sum + e.connections, 0))}
							variant="tertiary"
						/>
					</div>
				</div>

				{/* Main Grid */}
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
					{/* Intelligence Feed */}
					<div className="lg:col-span-2 space-y-3">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<StatusDot variant="default" size="sm" pulse />
								<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
									INTELLIGENCE_FEED
								</span>
								<span className="font-mono text-body tabular-nums text-outline">
									{casesData.length} CASES
								</span>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-body uppercase tracking-wider text-outline border-0 hover:text-primary"
							>
								SCAN_ALL
							</Button>
						</div>

						<div className="relative bracket-top-left bracket-bottom-right">
							<div className="border grid gap-2 p-1 border-outline-variant/30 divide-y divide-outline-variant/10">
								{isLoading ? (
									<div className="py-8 text-center">
										<StatusDot variant="muted" size="md" pulse />
										<span className="font-mono text-body text-outline ml-2">
											LOADING...
										</span>
									</div>
								) : casesData.length === 0 ? (
									<EmptyStatePreset variant="no-cases" />
								) : (
									casesData.map((c) => (
										<Link
											key={c.id}
											to="/cases/$caseId"
											params={{ caseId: String(c.id) }}
											className="relative border border-outline-variant/20 hover:border-primary/20 transition-all duration-300 group block"
											style={{ backgroundColor: "rgba(24, 27, 37, 0.6)" }}
										>
											<div className="pl-5 pr-4 py-3">
												<div className="flex items-start justify-between gap-3">
													<div className="flex items-center gap-3 min-w-0">
														<span className="font-mono text-body tabular-nums text-primary/30 shrink-0">
															{c.caseNumber}
														</span>
														<span className="font-mono text-xs text-on-surface leading-tight truncate">
															{c.title}
														</span>
													</div>
													<div className="flex items-center gap-2 shrink-0">
														<StatusChip
															variant={c.status === "active" ? "success" : c.status === "closed" ? "muted" : "warning"}
															size="sm"
														>
															{c.status?.toUpperCase()}
														</StatusChip>
													</div>
												</div>
												<div className="flex items-center gap-3 mt-2">
<span className="font-mono text-body text-outline">
													{c.caseType}
												</span>
													{c.parties && c.parties[0] && (
														<span className="font-mono text-body uppercase tracking-wider text-primary/25">
															{c.parties[0]}
														</span>
													)}
													<div className="flex items-center gap-3 ml-auto">
														{c.tags && c.tags.map((t: string) => (
															<span key={t} className="font-mono text-body tabular-nums text-outline">
																#{t}
															</span>
														))}
														<span className="hidden sm:block font-mono text-body tabular-nums text-outline">
															{new Date(c.updatedAt || c.createdAt).toLocaleDateString()}
														</span>
													</div>
												</div>
											</div>
										</Link>
									))
								)}
							</div>
						</div>
					</div>

					{/* Side Panel */}
					<div className="space-y-4">
						{/* Entity Network */}
						<GlassPanel variant="default" brackets="both" padding="md">
							<div className="flex items-center gap-2 mb-3">
								<StatusDot variant="success" size="sm" pulse />
								<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
									ENTITY_NETWORK
								</span>
								<span className="ml-auto font-mono text-body tabular-nums text-primary/30">
									{entities.length} LINKED
								</span>
							</div>

							<div className="space-y-0">
								{entities.map((e, i) => (
									<EntityRow key={e.id} entity={e} index={i} />
								))}
							</div>

							<Button
								variant="ghost"
								size="sm"
								brackets={false}
								className="w-full mt-3 h-7 text-body uppercase tracking-wider text-outline border-0 hover:text-primary"
							>
								EXPAND_NETWORK{" "}
							</Button>
						</GlassPanel>

						{/* System Telemetry */}
						<GlassPanel variant="default" brackets="bottom" padding="md">
							<div className="flex items-center gap-2 mb-3">
								<StatusDot variant="success" size="sm" />
								<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
									SYSTEM_STATUS
								</span>
							</div>
							<SystemTelemetry />
						</GlassPanel>

						{/* Live Log */}
						<GlassPanel variant="default" brackets="none" padding="md">
							<div className="flex items-center gap-2 mb-2">
								<StatusDot variant="default" size="sm" pulse />
								<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
									LIVE_TELEMETRY
								</span>
							</div>
							<LiveLog />
						</GlassPanel>
					</div>
				</div>
			</div>
		</AppShell>
	);
}
