import { lazy, Suspense } from "react";
import type { CaseNetworkEdge, CaseNetworkNode } from "#/integrations/trpc/routers/cases";

export { layoutNodes } from "#/components/graph-layout";
export type { LaidOutNode } from "#/components/graph-layout";

const GraphWorld = lazy(() =>
	import("#/components/graph-world").then((m) => ({ default: m.GraphWorld })),
);

export function IsoNetworkScene(props: {
	nodes: CaseNetworkNode[];
	edges: CaseNetworkEdge[];
	selectedId: string | null;
	focusId?: string | null;
	onSelect: (id: string | null) => void;
	onEnter?: (node: CaseNetworkNode) => void;
	catalog?: CaseNetworkNode[];
	onAdd?: (id: string) => void;
}) {
	return (
		<Suspense
			fallback={
				<div className="h-full w-full flex items-center justify-center bg-surface-container-lowest">
					<span className="font-mono text-body text-outline">LOADING_WORLD</span>
				</div>
			}
		>
			<GraphWorld {...props} />
		</Suspense>
	);
}
