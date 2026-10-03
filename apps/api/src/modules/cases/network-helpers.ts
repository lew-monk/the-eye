import type { CaseNetworkEdge, CaseNetworkNode, NetworkFocus } from './types'

export function parseFocus(raw: string): NetworkFocus | null {
	const trimmed = raw.trim()
	const split = trimmed.indexOf(':')
	if (split <= 0) return null
	const type = trimmed.slice(0, split)
	const id = trimmed.slice(split + 1)
	if (!id) return null
	if (type === 'case' || type === 'entity' || type === 'role') return { type, id }
	if (type === 'document' || type === 'doc') return { type: 'document', id }
	return null
}

export function focusNodeId(focus: NetworkFocus): string {
	if (focus.type === 'document') return `doc:${focus.id}`
	return `${focus.type}:${focus.id}`
}

export function pushNode(nodes: CaseNetworkNode[], node: CaseNetworkNode) {
	if (!nodes.some((n) => n.id === node.id)) nodes.push(node)
}

export function pushEdge(edges: CaseNetworkEdge[], edge: CaseNetworkEdge) {
	if (
		!edges.some(
			(e) => e.source === edge.source && e.target === edge.target && e.kind === edge.kind,
		)
	) {
		edges.push(edge)
	}
}
