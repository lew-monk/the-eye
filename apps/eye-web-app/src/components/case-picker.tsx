import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, EmptyState, GlassPanel, InputField, StatusChip } from "@workspace/ui";
import type { CaseData } from "#/integrations/trpc/routers/cases";

export function CasePicker({
	cases,
	isLoading,
	notice,
	onSelect,
}: {
	cases: CaseData[];
	isLoading: boolean;
	notice?: string | null;
	onSelect: (id: number) => void;
}) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return cases;
		return cases.filter(
			(c) =>
				c.caseNumber.toLowerCase().includes(q) ||
				c.title.toLowerCase().includes(q) ||
				(c.caseType ?? "").toLowerCase().includes(q),
		);
	}, [cases, query]);

	return (
		<div className="flex-1 min-h-0 overflow-y-auto">
			<div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
				<div className="space-y-1">
					<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
						NETWORK // SELECT_CASE
					</div>
					<h1 className="font-mono text-body-lg font-bold text-on-surface">
						Pick a case to load its network
					</h1>
					<p className="font-mono text-body text-outline reading">
						Networks are built per case only — nothing is computed across all
						onboarded cases until you open one.
					</p>
				</div>

				{notice && (
					<GlassPanel brackets="both" padding="sm" className="border-warning/40">
						<span className="font-mono text-body text-warning">{notice}</span>
					</GlassPanel>
				)}

				<div className="flex items-end gap-3">
					<div className="flex-1">
						<InputField
							label="SEARCH_CASES"
							placeholder="case number, title, type…"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</div>
					<span className="font-mono text-meta tabular-nums text-outline pb-3 shrink-0">
						{filtered.length}/{cases.length}
					</span>
				</div>

				{isLoading ? (
					<div className="font-mono text-body text-outline">LOADING_CASES…</div>
				) : cases.length === 0 ? (
					<EmptyState
						heading="NO_CASES_ONBOARD"
						body="No cases have been onboarded yet — create one to start mapping its network."
					/>
				) : filtered.length === 0 ? (
					<EmptyState
						heading="NO_MATCHES"
						body="Nothing matches the current search — try adjusting it."
						action={{ label: "CLEAR_FILTERS", onAction: () => setQuery("") }}
					/>
				) : (
					<div className="space-y-2">
						{filtered.map((c) => (
							<GlassPanel key={c.id} brackets="both" padding="sm">
								<div className="flex items-center gap-3 min-w-0">
									<div className="min-w-0 flex-1">
										<div className="font-mono text-body font-bold text-on-surface truncate">
											{c.caseNumber}
										</div>
										<div className="font-mono text-body text-on-surface/80 truncate">
											{c.title}
										</div>
										<div className="flex flex-wrap gap-1.5 mt-1.5">
											<StatusChip variant="muted" size="sm">
												{c.caseType || "case"}
											</StatusChip>
											<StatusChip
												variant={c.status === "active" ? "success" : "muted"}
												size="sm"
											>
												{c.status || "unknown"}
											</StatusChip>
										</div>
									</div>
									<div className="flex items-center gap-2 shrink-0">
										<Button variant="ghost" size="sm" brackets={false} asChild>
											<Link
												to="/cases/$caseId"
												params={{ caseId: String(c.id) }}
											>
												OPEN_CASE
											</Link>
										</Button>
										<Button
											variant="default"
											size="sm"
											brackets={false}
											onClick={() => onSelect(c.id)}
										>
											OPEN_NETWORK →
										</Button>
									</div>
								</div>
							</GlassPanel>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
