import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { GlassPanel, WeightBar, Button, StatusDot, StatusChip, EmptyStatePreset, Drawer } from "@workspace/ui";
import { useState } from "react";
import { AppShell } from "#/components/app-shell";
import { useTRPC } from "#/integrations/trpc/react";
import type { EntityDossierData } from "#/integrations/trpc/routers/cases";

export const Route = createFileRoute("/entities/$entityName")({
	component: EntityDetail,
});

const ROLE_LABELS: Record<string, string> = {
	judge: "JUDGE",
	lawyer: "COUNSEL",
	police: "LAW_ENFORCEMENT",
	witness: "WITNESS",
	prosecution: "PROSECUTION",
	magistrate: "MAGISTRATE",
	defendant: "DEFENDANT",
	plaintiff: "PLAINTIFF",
	prosecutor: "PROSECUTOR",
	court: "COURT",
};

function roleLabel(role: string): string {
	return ROLE_LABELS[role] ?? role.toUpperCase().replace(/_/g, "_");
}

function MentionContextDoc({
	mc,
}: {
	mc: EntityDossierData["mentionContexts"][number];
}) {
	const [drawerOpen, setDrawerOpen] = useState(false);

	return (
		<div className="px-5 py-3">
			<div className="flex items-center gap-2 mb-3">
				<Link
					to="/cases/$caseId"
					params={{
						caseId: String(mc.caseId ?? ""),
					}}
					className="font-mono text-body text-primary/40 hover:text-primary transition-colors"
				>
					{mc.caseNumber ? `${mc.caseNumber} — ` : ""}{mc.filename}
				</Link>
				<span className="font-mono text-meta text-outline">
					{mc.mentions.length} MENTION{mc.mentions.length !== 1 ? "S" : ""}
				</span>
			</div>
			<div className="space-y-3">
				{mc.mentions.slice(0, 3).map((m, i) => (
					<div key={i} className="border border-primary/15 bg-primary/[0.03]">
						<div className="flex items-center justify-between px-3 py-1.5 border-b border-primary/10 bg-primary/[0.04]">
							<span className="font-mono text-meta uppercase tracking-[0.12em] text-primary/40">
								MENTION_{i + 1}
							</span>
							<div className="flex items-center gap-3">
								<span className="font-mono text-meta text-outline">
									POS: [{m.start}..{m.end}]
								</span>
								<span className="font-mono text-meta text-outline">
									LEN: {m.end - m.start} CHARS
								</span>
							</div>
						</div>
						<div className="p-3">
							<div className="mb-2">
								<span className="font-mono text-meta-sm uppercase tracking-[0.12em] text-outline block mb-0.5">
									MENTION_TEXT
								</span>
								<code className="font-mono text-body-lg text-primary/80 bg-primary/[0.06] px-2 py-0.5 inline-block">
									{m.text}
								</code>
							</div>
							<div>
								<span className="font-mono text-meta-sm uppercase tracking-[0.12em] text-outline block mb-0.5">
									SURROUNDING_CONTEXT
								</span>
								<p className="font-mono text-body text-on-surface-variant leading-relaxed">
									{m.context}
								</p>
							</div>
						</div>
					</div>
				))}
				{mc.mentions.length > 3 && (
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="w-full text-meta"
						onClick={() => setDrawerOpen(true)}
					>
						SHOW_ALL ({mc.mentions.length - 3} MORE)
					</Button>
				)}
				{mc.caseNumber && (
					<div className="flex items-center gap-2 pt-1 border-t border-outline-variant/10">
						<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
							CASE
						</span>
						<Link
							to="/cases/$caseId"
							params={{ caseId: String(mc.caseId) }}
							className="font-mono text-meta-sm text-primary/50 hover:text-primary transition-colors"
						>
							{mc.caseNumber}
						</Link>
					</div>
				)}
			</div>

			<Drawer
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
				title={`ALL MENTIONS — ${mc.filename}`}
				size="lg"
			>
				<div className="divide-y divide-outline-variant/10">
					{mc.mentions.map((m, i) => (
						<div key={i} className="p-4">
							<div className="flex items-center justify-between mb-2">
								<span className="font-mono text-meta uppercase tracking-[0.12em] text-primary/40">
									MENTION_{i + 1}
								</span>
								<div className="flex items-center gap-3">
									<span className="font-mono text-meta text-outline">
										POS: [{m.start}..{m.end}]
									</span>
									<span className="font-mono text-meta text-outline">
										LEN: {m.end - m.start} CHARS
									</span>
								</div>
							</div>
							<div className="p-3 border border-primary/15 bg-primary/[0.03]">
								<div className="mb-2">
									<span className="font-mono text-meta-sm uppercase tracking-[0.12em] text-outline block mb-0.5">
										MENTION_TEXT
									</span>
									<code className="font-mono text-body-lg text-primary/80 bg-primary/[0.06] px-2 py-0.5 inline-block">
										{m.text}
									</code>
								</div>
								<div>
									<span className="font-mono text-meta-sm uppercase tracking-[0.12em] text-outline block mb-0.5">
										SURROUNDING_CONTEXT
									</span>
									<p className="font-mono text-body text-on-surface-variant leading-relaxed">
										{m.context}
									</p>
								</div>
							</div>
						</div>
					))}
				</div>
			</Drawer>
		</div>
	);
}

function EntityDetail() {
	const { entityName } = useParams({ from: "/entities/$entityName" });
	const trpc = useTRPC();
	const decodedName = decodeURIComponent(entityName);

	const { data: dossier, isLoading } = useQuery({
		...trpc.cases.getEntityDossier.queryOptions({ normalizedName: decodedName }),
		enabled: !!decodedName,
	});

	return (
		<AppShell>
			<div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-4">
			<button
				onClick={() => window.history.back()}
				className="inline-flex items-center gap-1.5 font-mono text-body uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors"
			>
				<span className="text-body-lg leading-none">&larr;</span>
				BACK
			</button>

				{isLoading ? (
					<div className="py-12 text-center">
						<StatusDot variant="muted" size="md" pulse />
						<span className="font-mono text-body text-outline ml-2">
							LOADING_DOSSIER...
						</span>
					</div>
				) : !dossier ? (
					<div className="py-12 text-center">
						<span className="font-mono text-body text-destructive/60">
							ENTITY_NOT_FOUND
						</span>
					</div>
				) : (
					<>
						<GlassPanel variant="default" brackets="both" padding="md">
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<div className="flex items-center gap-3 mb-2">
										<span className="font-mono text-body tabular-nums text-primary/40">
											ENTITY_DOSSIER
										</span>
										<StatusDot variant="success" size="sm" pulse />
									</div>
									<h1 className="font-mono text-sm text-on-surface mb-1">
										{dossier.displayName}
									</h1>
									{dossier.mentionContexts.length > 0 && (
										<div className="flex flex-wrap gap-1.5 mb-2">
											{Array.from(
												new Set(
													dossier.mentionContexts.flatMap((mc) => mc.allMentions),
												),
											).map((m, i) => (
												<code
													key={i}
													className="font-mono text-meta-sm text-primary/60 bg-primary/[0.06] px-1.5 py-0.5"
												>
													{m}
												</code>
											))}
										</div>
									)}
									{dossier.totalCases > 0 && (
										<div className="flex flex-wrap gap-1.5 mb-2">
											{Array.from(
												new Map(
													dossier.appearances
														.filter((a) => a.caseNumber)
														.map((a) => [a.caseId, a]),
												).values(),
											).map((a) => (
												<Link
													key={a.caseId}
													to="/cases/$caseId"
													params={{ caseId: String(a.caseId) }}
													className="font-mono text-meta-sm text-primary/50 hover:text-primary transition-colors bg-primary/[0.06] px-1.5 py-0.5"
												>
													{a.caseNumber}
												</Link>
											))}
										</div>
									)}
									<div className="flex items-center gap-3 text-body text-outline">
										<span className="uppercase tracking-[0.12em]">
											{roleLabel(dossier.primaryRole)}
										</span>
										<span className="text-outline">|</span>
										<span>{dossier.totalMentions} MENTIONS</span>
										<span className="text-outline">|</span>
										<span>{dossier.totalDocuments} DOCS</span>
										<span className="text-outline">|</span>
										<span>{dossier.totalCases} CASES</span>
									</div>
								</div>

								<div className="hidden sm:flex flex-col items-end gap-1">
									<span className="font-mono text-meta uppercase tracking-wider text-outline">
										CONFIDENCE
									</span>
									<WeightBar
										value={dossier.confidence.overallScore}
										density="standard"
										className="w-[120px]"
									/>
									<span className="font-mono text-body tabular-nums text-primary/60">
										{dossier.confidence.overallScore}%
									</span>
								</div>
							</div>
						</GlassPanel>

						<div className="lg:grid lg:grid-cols-12 lg:gap-6 space-y-4 lg:space-y-0">
							<div className="lg:col-span-8 space-y-4">
								<GlassPanel variant="default" brackets="both" padding="md">
									<div className="flex items-center gap-2 mb-3">
										<StatusDot variant="default" size="sm" pulse />
										<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
											CONFIDENCE_ANALYSIS
										</span>
									</div>

									<div className="grid grid-cols-3 gap-4 mb-4">
										<div className="border border-outline-variant/20 p-3 text-center">
											<span className="block font-mono text-meta-sm uppercase tracking-[0.12em] text-outline mb-1">
												ROLE_CONSENSUS
											</span>
											<WeightBar
												value={dossier.confidence.roleConsistency}
												density="compact"
												className="mb-1"
											/>
											<span className="font-mono text-body tabular-nums text-primary/60">
												{dossier.confidence.roleConsistency}%
											</span>
										</div>
										<div className="border border-outline-variant/20 p-3 text-center">
											<span className="block font-mono text-meta-sm uppercase tracking-[0.12em] text-outline mb-1">
												DOC_COVERAGE
											</span>
											<WeightBar
												value={dossier.confidence.documentCoverage}
												density="compact"
												className="mb-1"
											/>
											<span className="font-mono text-body tabular-nums text-primary/60">
												{dossier.confidence.documentCoverage}%
											</span>
										</div>
										<div className="border border-outline-variant/20 p-3 text-center">
											<span className="block font-mono text-meta-sm uppercase tracking-[0.12em] text-outline mb-1">
												OVERALL
											</span>
											<WeightBar
												value={dossier.confidence.overallScore}
												density="compact"
												className="mb-1"
											/>
											<span className="font-mono text-body tabular-nums text-primary/60">
												{dossier.confidence.overallScore}%
											</span>
										</div>
									</div>

									{dossier.confidence.roles.length > 0 && (
										<div className="mb-3">
											<span className="block font-mono text-meta uppercase tracking-[0.12em] text-outline mb-2">
												ROLE_DISTRIBUTION
											</span>
											<div className="flex flex-wrap gap-1.5">
												{dossier.confidence.roles.map((r) => (
													<StatusChip
														key={r.role}
														variant="secondary"
														size="sm"
													>
														{roleLabel(r.role)} ({r.count}x)
													</StatusChip>
												))}
											</div>
										</div>
									)}

									{dossier.confidence.flags.length > 0 && (
										<div>
											<span className="block font-mono text-meta uppercase tracking-[0.12em] text-warning/60 mb-2">
												INTELLIGENCE_FLAGS
											</span>
											<div className="space-y-1">
												{dossier.confidence.flags.map((flag, i) => (
													<div
														key={i}
														className="flex items-center gap-2 px-3 py-2 border border-warning/20 bg-warning/5"
													>
														<StatusDot variant="warning" size="sm" />
														<span className="font-mono text-meta text-outline leading-relaxed">
															{flag}
														</span>
													</div>
												))}
											</div>
										</div>
									)}
								</GlassPanel>

								<GlassPanel variant="default" brackets="both" padding="none">
									<div className="px-5 py-3 border-b border-outline-variant/10">
										<div className="flex items-center gap-2">
											<StatusDot variant="default" size="sm" pulse />
											<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
												APPEARANCES
											</span>
											<span className="font-mono text-body text-outline">
												{dossier.appearances.length}
											</span>
										</div>
									</div>
									<div className="divide-y divide-outline-variant/10">
										{dossier.appearances.map((a) => (
											<div
												key={a.participantId}
												className="px-5 py-3 hover:bg-surface/50 transition-colors"
											>
												<div className="flex items-start justify-between gap-4">
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2 mb-0.5">
															<span className="font-mono text-body text-on-surface-variant truncate">
																{a.filename}
															</span>
															<span className="font-mono text-meta text-outline shrink-0 uppercase">
																{a.documentType}
															</span>
														</div>
														<div className="flex items-center gap-2 text-meta text-outline">
															<span>{roleLabel(a.role)}</span>
															{a.caseNumber && (
																<>
																	<span className="text-outline">|</span>
																	<Link
																		to="/cases/$caseId"
																		params={{ caseId: String(a.caseId) }}
																		className="text-primary/50 hover:text-primary transition-colors"
																	>
																		{a.caseNumber}
																	</Link>
																</>
															)}
															<span className="text-outline">|</span>
															<span>{a.mentionCount} mentions</span>
														</div>
													</div>
													<div className="shrink-0">
														<WeightBar
															value={Math.round((a.relevanceScore ?? 0) * 100)}
															density="compact"
															className="w-[80px]"
														/>
													</div>
												</div>
											</div>
										))}
									</div>
								</GlassPanel>

								{dossier.mentionContexts.length > 0 && (
									<GlassPanel variant="default" brackets="both" padding="none">
										<div className="px-5 py-3 border-b border-outline-variant/10">
											<div className="flex items-center gap-2">
												<StatusDot variant="default" size="sm" pulse />
												<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
													MENTION_CONTEXTS
												</span>
												<span className="font-mono text-body text-outline">
													{dossier.mentionContexts.reduce((sum, mc) => sum + mc.mentions.length, 0)} MENTIONS ACROSS {dossier.mentionContexts.length} DOCS
												</span>
											</div>
										</div>
										<div className="divide-y divide-outline-variant/10">
											{dossier.mentionContexts.map((mc) => (
												<MentionContextDoc key={mc.participantId} mc={mc} />
											))}
										</div>
									</GlassPanel>
								)}
							</div>

							<div className="lg:col-span-4 space-y-4">
								<GlassPanel variant="default" brackets="both" padding="md">
									<div className="flex items-center gap-2 mb-3">
										<StatusDot variant="default" size="sm" pulse />
										<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
											ROLE_BREAKDOWN
										</span>
									</div>
									{dossier.roleDistribution.length === 0 ? (
										<EmptyStatePreset variant="no-entities" size="sm" />
									) : (
										<div className="space-y-1.5">
											{dossier.roleDistribution.map((rd) => (
												<div
													key={rd.role}
													className="flex items-center justify-between px-3 py-1.5 border border-outline-variant/10"
												>
													<span className="font-mono text-body text-on-surface-variant">
														{roleLabel(rd.role)}
													</span>
													<div className="flex items-center gap-2">
														<WeightBar
															value={rd.percentage}
															density="compact"
															className="w-[60px]"
														/>
														<span className="font-mono text-body tabular-nums text-outline w-8 text-right">
															{rd.percentage}%
														</span>
													</div>
												</div>
											))}
										</div>
									)}
								</GlassPanel>

								{dossier.coOccurringEntities.length > 0 && (
									<GlassPanel variant="default" brackets="both" padding="none">
										<div className="px-5 py-3 border-b border-outline-variant/10">
											<div className="flex items-center gap-2">
												<StatusDot variant="default" size="sm" pulse />
												<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
													CO_OCCURRING
												</span>
												<span className="font-mono text-body text-outline">
													{dossier.coOccurringEntities.length}
												</span>
											</div>
										</div>
										<div className="divide-y divide-outline-variant/10">
											{dossier.coOccurringEntities.map((co, idx) => (
												<Link
													key={idx}
													to="/entities/$entityName"
													params={{
														entityName: encodeURIComponent(co.normalizedName),
													}}
													className="px-5 py-2.5 hover:bg-surface/50 transition-colors block"
												>
													<div className="flex items-center justify-between">
														<div className="min-w-0">
															<span className="font-mono text-body text-on-surface-variant block truncate">
																{co.displayName}
															</span>
															<div className="flex items-center gap-1.5 mt-0.5">
																{co.roles.slice(0, 2).map((r) => (
																	<StatusChip key={r} variant="secondary" size="sm">
																		{roleLabel(r)}
																	</StatusChip>
																))}
															</div>
														</div>
														<span className="font-mono text-meta text-outline">
															{co.docCount} DOC{co.docCount !== 1 ? "S" : ""}
														</span>
													</div>
												</Link>
											))}
										</div>
									</GlassPanel>
								)}

								{dossier.totalCases > 0 && (
									<GlassPanel variant="default" brackets="both" padding="md">
										<div className="flex items-center gap-2 mb-3">
											<StatusDot variant="default" size="sm" pulse />
											<span className="font-mono text-body uppercase tracking-[0.15em] text-on-surface-variant">
												CASES
											</span>
											<span className="font-mono text-body text-outline">
												{dossier.totalCases}
											</span>
										</div>
										<div className="space-y-1">
											{Array.from(
												new Map(
													dossier.appearances
														.filter((a) => a.caseNumber)
														.map((a) => [a.caseNumber, a]),
												).values(),
											).map((a) => (
												<Link
													key={a.caseNumber}
													to="/cases/$caseId"
													params={{ caseId: String(a.caseId) }}
													className="flex items-center gap-2 px-2 py-1 hover:bg-surface/50 transition-colors block"
												>
													<span className="font-mono text-body tabular-nums text-primary/40">
														{a.caseNumber}
													</span>
<span className="font-mono text-meta text-outline truncate">
													→
												</span>
												</Link>
											))}
										</div>
									</GlassPanel>
								)}
							</div>
						</div>
					</>
				)}
			</div>
		</AppShell>
	);
}
