import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { targetRadius } from "#/components/graph-layout";
import { connectionStrength } from "#/components/graph-relevance";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@workspace/ui";
import * as THREE from "three";
import type { CaseNetworkEdge, CaseNetworkNode } from "#/integrations/trpc/routers/cases";
import { layoutNodes, type LaidOutNode } from "#/components/graph-layout";

const S = 1.85;

function toWorld(n: LaidOutNode) {
	const sx = n.w * S * 0.82;
	const sy = 0.38 + n.h * 0.95;
	const sz = n.d * S * 0.82;
	return {
		x: n.gx * S,
		y: sy / 2,
		z: n.gy * S,
		sx,
		sy,
		sz,
	};
}

function easeOutCubic(t: number) {
	const x = Math.min(1, Math.max(0, t));
	return 1 - (1 - x) ** 3;
}

const SNAP_RADIUS = 2.6;
const SNAP_MS = 520;

const PERSON_ROLES = new Set([
	"judge",
	"lawyer",
	"police",
	"witness",
	"defendant",
	"plaintiff",
	"prosecutor",
	"magistrate",
	"prosecution",
]);

type BoardKind = "person" | "org" | "case" | "document" | "other";

function boardKind(node: CaseNetworkNode): BoardKind {
	if (node.kind === "document") return "document";
	if (node.kind === "case" || node.kind === "connected_case" || node.kind === "similar_case") {
		return "case";
	}
	if (node.kind === "entity" && PERSON_ROLES.has(node.role ?? "")) return "person";
	if (node.kind === "entity" || node.kind === "role") return "org";
	return "other";
}

const BOARD_COLOR: Record<BoardKind, string> = {
	person: "#e8b86d",
	org: "#966cf6",
	case: "#4df6e0",
	document: "#2dd4bf",
	other: "#8a9a96",
};

function colorFor(node: CaseNetworkNode) {
	return BOARD_COLOR[boardKind(node)];
}

function typeLabel(node: CaseNetworkNode) {
	const k = boardKind(node);
	if (k === "person") return "Person";
	if (k === "org") return node.kind === "role" ? "Role" : "Organization";
	if (k === "case") return "Case";
	if (k === "document") return "Document";
	return "Other";
}

function shortLabel(label: string, max = 16) {
	if (label.length <= max) return label;
	return `${label.slice(0, max - 1)}…`;
}

function kindLetter(kind: string) {
	if (kind === "case" || kind === "connected_case" || kind === "similar_case") return "C";
	if (kind === "role") return "R";
	if (kind === "document") return "D";
	if (kind === "signal") return "S";
	return "N";
}

function sceneBounds(laid: LaidOutNode[]) {
	if (laid.length === 0) {
		return { cx: 0, cz: 0, cy: 1, span: 16 };
	}
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	let maxY = 1;
	for (const n of laid) {
		const w = toWorld(n);
		minX = Math.min(minX, w.x);
		maxX = Math.max(maxX, w.x);
		minZ = Math.min(minZ, w.z);
		maxZ = Math.max(maxZ, w.z);
		maxY = Math.max(maxY, w.sy);
	}
	const span = Math.max(maxX - minX, maxZ - minZ, 10);
	return {
		cx: (minX + maxX) / 2,
		cz: (minZ + maxZ) / 2,
		cy: maxY * 0.35,
		span,
	};
}

function CameraRig({
	focus,
	laid,
	mode,
	flyToken,
}: {
	focus: LaidOutNode | null;
	laid: LaidOutNode[];
	mode: "overview" | "node";
	flyToken: number;
}) {
	const { camera, controls } = useThree();
	const destPos = useRef(new THREE.Vector3());
	const destTarget = useRef(new THREE.Vector3());
	const active = useRef(false);

	useEffect(() => {
		if (mode === "node" && focus) {
			const w = toWorld(focus);
			destTarget.current.set(w.x, w.sy * 0.35, w.z);
			destPos.current.set(w.x + 14, Math.max(10, w.sy + 11), w.z + 14);
		} else {
			const b = sceneBounds(laid);
			destTarget.current.set(b.cx, b.cy, b.cz);
			const dist = Math.max(22, b.span * 1.35);
			destPos.current.set(b.cx + dist * 0.72, dist * 0.62, b.cz + dist * 0.72);
		}
		active.current = true;
	}, [focus, laid, mode, flyToken]);

	useFrame((_, dt) => {
		if (!active.current) return;
		const t = 1 - Math.pow(0.0008, dt);
		camera.position.lerp(destPos.current, t);
		const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
		if (c?.target) {
			c.target.lerp(destTarget.current, t);
			c.update();
		}
		if (camera.position.distanceTo(destPos.current) < 0.12) active.current = false;
	});

	return null;
}

function GraphBox({
	node,
	selected,
	hovered,
	dimmed,
	showLabel,
	parked,
	pose,
	onSelect,
	onEnter,
	onHover,
	onDragStart,
	onMenu,
	onRemove,
	isPin,
}: {
	node: LaidOutNode;
	selected: boolean;
	hovered: boolean;
	dimmed: boolean;
	showLabel: boolean;
	parked: boolean;
	pose: { x: number; y: number; z: number };
	onSelect: (id: string) => void;
	onEnter?: (node: CaseNetworkNode) => void;
	onHover: (id: string | null) => void;
	onDragStart: (id: string, clientX: number, clientY: number) => void;
	onMenu: (node: LaidOutNode, x: number, y: number) => void;
	onRemove?: (id: string) => void;
	isPin?: boolean;
}) {
	const w = toWorld(node);
	const color = colorFor(node);
	const kind = boardKind(node);
	const geom = useMemo(() => {
		if (kind === "other") return new THREE.IcosahedronGeometry(Math.max(w.sx, w.sz) * 0.42, 0);
		if (kind === "document") return new THREE.BoxGeometry(w.sx * 1.15, Math.max(0.16, w.sy * 0.34), w.sz * 1.15);
		if (kind === "case") return new THREE.BoxGeometry(w.sx * 0.82, w.sy * 1.2, w.sz * 0.82);
		return new THREE.BoxGeometry(w.sx, w.sy, w.sz);
	}, [kind, w.sx, w.sy, w.sz]);
	const pointer = useRef({ x: 0, y: 0, t: 0, dragged: false });
	const glow = node.importance ?? 0.3;
	const emissive = selected || parked ? color : hovered ? color : color;
	const emissiveIntensity = selected ? 0.45 : parked ? 0.08 : hovered ? 0.2 : glow * 0.28;
	const scale = selected ? 1.07 : hovered || parked ? 1.03 : 1;
	const opacity = parked ? 0.32 : dimmed ? 0.2 : 0.58 + glow * 0.38;

	return (
		<group
			position={[pose.x, pose.y, pose.z]}
			scale={scale}
			onPointerOver={(e) => {
				e.stopPropagation();
				onHover(node.id);
			}}
			onPointerOut={() => onHover(null)}
			onPointerDown={(e) => {
				e.stopPropagation();
				if (e.button !== 0) return;
				pointer.current = { x: e.clientX, y: e.clientY, t: Date.now(), dragged: false };
				onDragStart(node.id, e.clientX, e.clientY);
			}}
			onContextMenu={(e) => {
				e.stopPropagation();
				e.nativeEvent.preventDefault();
				onMenu(node, e.nativeEvent.clientX, e.nativeEvent.clientY);
			}}
			onPointerUp={(e) => {
				e.stopPropagation();
				const dx = e.clientX - pointer.current.x;
				const dy = e.clientY - pointer.current.y;
				if (dx * dx + dy * dy > 25) return;
				if (Date.now() - pointer.current.t < 280) onSelect(node.id);
			}}
			onDoubleClick={(e) => {
				e.stopPropagation();
				onEnter?.(node);
			}}
		>
			{kind === "person" ? (
				<RoundedBox args={[w.sx, w.sy, w.sz]} radius={0.14} smoothness={4} castShadow receiveShadow>
					<meshStandardMaterial
						color={color}
						roughness={0.72}
						metalness={0.04}
						transparent
						opacity={opacity}
						emissive={emissive}
						emissiveIntensity={emissiveIntensity}
					/>
				</RoundedBox>
			) : (
				<mesh castShadow receiveShadow geometry={geom}>
					<meshStandardMaterial
						color={color}
						roughness={kind === "org" ? 0.22 : kind === "document" ? 0.55 : 0.42}
						metalness={kind === "org" ? 0.45 : 0.12}
						transparent
						opacity={opacity}
						emissive={emissive}
						emissiveIntensity={emissiveIntensity}
					/>
				</mesh>
			)}
			{kind !== "person" && kind !== "other" && (
				<lineSegments>
					<edgesGeometry args={[geom]} />
					<lineBasicMaterial
						color={selected ? "#4df6e0" : parked ? "#4df6e0" : color}
						transparent
						opacity={parked ? 0.45 : dimmed ? 0.1 : 0.4}
						dashed={parked}
					/>
				</lineSegments>
			)}
			{(showLabel || hovered) && (
				<Html
					position={[0, w.sy / 2 + 0.22, 0]}
					center
					distanceFactor={22}
					style={{ pointerEvents: hovered ? "auto" : "none", userSelect: "none" }}
					zIndexRange={[10, 0]}
				>
					<div className="font-mono text-center whitespace-nowrap relative">
						{hovered && onRemove && !isPin && (
							<Button
								variant="ghost"
								size="icon"
								brackets={false}
								className="absolute -right-7 -top-1 h-5 w-5 text-meta text-destructive/80"
								onPointerDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.stopPropagation();
									onRemove(node.id);
								}}
							>
								×
							</Button>
						)}
						<div className="text-meta-sm uppercase tracking-[0.14em] text-outline">
							{typeLabel(node)}
							{parked ? " · SET ASIDE" : ""}
						</div>
						<div className="text-meta text-on-surface bg-surface/80 px-1.5 py-0.5 border border-outline-variant/30">
							{shortLabel(node.label, node.kind === "case" ? 18 : 14)}
						</div>
					</div>
				</Html>
			)}
		</group>
	);
}

function GhostSlot({ node }: { node: LaidOutNode }) {
	const w = toWorld(node);
	const geom = useMemo(() => new THREE.BoxGeometry(w.sx, w.sy, w.sz), [w.sx, w.sy, w.sz]);
	return (
		<group position={[w.x, w.y, w.z]}>
			<mesh geometry={geom}>
				<meshStandardMaterial
					color="#4df6e0"
					transparent
					opacity={0.06}
					roughness={1}
					metalness={0}
				/>
			</mesh>
			<lineSegments>
				<edgesGeometry args={[geom]} />
				<lineBasicMaterial color="#4df6e0" transparent opacity={0.28} />
			</lineSegments>
		</group>
	);
}

function GraphEdges({
	edges,
	byId,
	poses,
	selectedId,
	pinId,
}: {
	edges: CaseNetworkEdge[];
	byId: Map<string, LaidOutNode>;
	poses: Record<string, { x: number; y: number; z: number }>;
	selectedId: string | null;
	pinId?: string | null;
}) {
	const paths = useMemo(() => {
		return edges
			.map((e, i) => {
				const a = byId.get(e.source);
				const b = byId.get(e.target);
				if (!a || !b) return null;
				const aw = poses[e.source] ?? toWorld(a);
				const bw = poses[e.target] ?? toWorld(b);
				const aTop = (poses[e.source]?.y ?? aw.y) + (toWorld(a).sy * 0.35);
				const bTop = (poses[e.target]?.y ?? bw.y) + (toWorld(b).sy * 0.35);
				const p1: [number, number, number] = [aw.x, aTop, aw.z];
				const p2: [number, number, number] = [bw.x, bTop, bw.z];
				const mid: [number, number, number] = [
					(p1[0] + p2[0]) / 2,
					(p1[1] + p2[1]) / 2 + 0.18,
					(p1[2] + p2[2]) / 2,
				];
				const active = Boolean(
					selectedId && (e.source === selectedId || e.target === selectedId),
				);
				const pin = pinId ?? selectedId;
				const strength = pin
					? Math.max(
							connectionStrength(e.source, pin, edges),
							connectionStrength(e.target, pin, edges),
						)
					: 0.2;
				return {
					key: `${e.source}-${e.target}-${i}`,
					points: [p1, mid, p2],
					active,
					strength,
					kind: e.kind,
				};
			})
			.filter(Boolean) as {
			key: string;
			points: [number, number, number][];
			active: boolean;
			strength: number;
			kind: string;
		}[];
	}, [edges, byId, poses, selectedId, pinId]);

	return (
		<>
			{paths.map((e) => (
				<Line
					key={e.key}
					points={e.points}
					color={e.active ? "#7aa8a0" : "#3b4a47"}
					lineWidth={0.35 + e.strength * 1.5}
					transparent
					opacity={selectedId ? (e.active ? 0.38 + e.strength * 0.2 : 0.05) : 0.08 + e.strength * 0.22}
				/>
			))}
		</>
	);
}

type Parked = Record<string, { x: number; z: number }>;
type Snap = { fromX: number; fromZ: number; toX: number; toZ: number; t: number };

function SceneBody({
	laid,
	edges,
	selectedId,
	focusId,
	onSelect,
	onEnter,
	onHover,
	hoverId,
	flyToken,
	frameMode,
	parked,
	setParked,
	snapAllToken,
	snapTarget,
	onParkedCount,
	onMenu,
	onSetAngle,
	onRemove,
	pinId,
}: {
	laid: LaidOutNode[];
	edges: CaseNetworkEdge[];
	selectedId: string | null;
	focusId?: string | null;
	onSelect: (id: string | null) => void;
	onEnter?: (node: CaseNetworkNode) => void;
	onHover: (id: string | null) => void;
	hoverId: string | null;
	flyToken: number;
	frameMode: "overview" | "node";
	parked: Parked;
	setParked: (next: Parked | ((p: Parked) => Parked)) => void;
	snapAllToken: number;
	snapTarget: string | null;
	onParkedCount: (n: number) => void;
	onMenu: (node: LaidOutNode, x: number, y: number) => void;
	onSetAngle: (id: string, theta: number) => void;
	onRemove: (id: string) => void;
	pinId?: string | null;
}) {
	const byId = useMemo(() => new Map(laid.map((n) => [n.id, n])), [laid]);
	const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
	const focus = (focusId ? byId.get(focusId) : null) ?? selected;
	const { camera, gl } = useThree();
	const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
	const raycaster = useMemo(() => new THREE.Raycaster(), []);
	const drag = useRef<{ id: string; ox: number; oz: number } | null>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [snaps, setSnaps] = useState<Record<string, Snap>>({});
	const [now, setNow] = useState(0);

	const hitFloor = (clientX: number, clientY: number) => {
		const rect = gl.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1,
		);
		raycaster.setFromCamera(ndc, camera);
		const out = new THREE.Vector3();
		if (!raycaster.ray.intersectPlane(plane, out)) return null;
		return out;
	};

	const beginSnap = (id: string, fromX: number, fromZ: number) => {
		const n = byId.get(id);
		if (!n) return;
		const home = toWorld(n);
		setSnaps((s) => ({
			...s,
			[id]: { fromX, fromZ, toX: home.x, toZ: home.z, t: 0 },
		}));
		setParked((p) => {
			const next = { ...p };
			delete next[id];
			return next;
		});
	};

	useEffect(() => {
		if (!snapAllToken) return;
		const entries = Object.entries(parked);
		if (entries.length === 0) return;
		setSnaps((s) => {
			const next = { ...s };
			for (const [id, pos] of entries) {
				const n = byId.get(id);
				if (!n) continue;
				const home = toWorld(n);
				next[id] = { fromX: pos.x, fromZ: pos.z, toX: home.x, toZ: home.z, t: 0 };
			}
			return next;
		});
		setParked({});
		// only when the user asks
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [snapAllToken]);

	useEffect(() => {
		if (!snapTarget) return;
		const pos = parked[snapTarget];
		if (pos) beginSnap(snapTarget, pos.x, pos.z);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [snapTarget]);

	useFrame((_, dt) => {
		if (Object.keys(snaps).length === 0) return;
		setSnaps((curr) => {
			const next: Record<string, Snap> = {};
			for (const [id, s] of Object.entries(curr)) {
				const t = s.t + dt / (SNAP_MS / 1000);
				if (t < 1) next[id] = { ...s, t };
			}
			return next;
		});
		setNow((n) => n + dt);
	});

	useEffect(() => {
		onParkedCount(Object.keys(parked).length);
	}, [parked, onParkedCount]);

	useEffect(() => {
		const move = (e: PointerEvent) => {
			const d = drag.current;
			if (!d) return;
			const hit = hitFloor(e.clientX, e.clientY);
			if (!hit) return;
			setParked((p) => ({
				...p,
				[d.id]: { x: hit.x - d.ox, z: hit.z - d.oz },
			}));
		};
		const up = (e: PointerEvent) => {
			const d = drag.current;
			if (!d) return;
			drag.current = null;
			setDraggingId(null);
			const n = byId.get(d.id);
			const hit = hitFloor(e.clientX, e.clientY);
			if (!n) return;
			const home = toWorld(n);
			const x = hit ? hit.x - d.ox : home.x;
			const z = hit ? hit.z - d.oz : home.z;
			const distOrigin = Math.hypot(x, z);
			if (distOrigin > 13.5) {
				setParked((p) => ({ ...p, [d.id]: { x, z } }));
				return;
			}
			const rel = n.relevanceToFocus ?? n.importance ?? 0.3;
			const r = targetRadius(rel);
			const theta = Math.atan2(z, x);
			onSetAngle(d.id, theta);
			setParked((p) => {
				const next = { ...p };
				delete next[d.id];
				return next;
			});
			setSnaps((s) => ({
				...s,
				[d.id]: {
					fromX: x,
					fromZ: z,
					toX: Math.cos(theta) * r,
					toZ: Math.sin(theta) * r,
					t: 0,
				},
			}));
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	}, [byId, parked]);

	const poses = useMemo(() => {
		const out: Record<string, { x: number; y: number; z: number }> = {};
		for (const n of laid) {
			const home = toWorld(n);
			const snap = snaps[n.id];
			if (snap) {
				const k = easeOutCubic(snap.t);
				out[n.id] = {
					x: snap.fromX + (snap.toX - snap.fromX) * k,
					y: home.y + (1 - k) * 0.35,
					z: snap.fromZ + (snap.toZ - snap.fromZ) * k,
				};
			} else if (parked[n.id]) {
				const lifting = drag.current?.id === n.id;
				out[n.id] = {
					x: parked[n.id].x,
					y: home.y + (lifting ? 0.42 : 0.12),
					z: parked[n.id].z,
				};
			} else {
				out[n.id] = { x: home.x, y: home.y, z: home.z };
			}
		}
		return out;
		// now is bumped during snap so poses refresh
	}, [laid, parked, snaps, now]);

	const startDrag = (id: string, clientX: number, clientY: number) => {
		const hit = hitFloor(clientX, clientY);
		const n = byId.get(id);
		if (!hit || !n) return;
		const pose = poses[id] ?? toWorld(n);
		drag.current = { id, ox: hit.x - pose.x, oz: hit.z - pose.z };
		setDraggingId(id);
		setSnaps((s) => {
			if (!s[id]) return s;
			const next = { ...s };
			delete next[id];
			return next;
		});
		onSelect(id);
	};

	return (
		<>
			<color attach="background" args={["#0a0e17"]} />
			<fog attach="fog" args={["#0a0e17", 40, 110]} />
			<ambientLight intensity={0.48} />
			<directionalLight
				position={[16, 22, 10]}
				intensity={1.05}
				color="#e8fff9"
				castShadow
				shadow-mapSize-width={1024}
				shadow-mapSize-height={1024}
			/>
			<pointLight position={[-10, 8, -8]} intensity={0.22} color="#4df6e0" />
			<gridHelper args={[72, 36, "#16332f", "#10151c"]} position={[0, 0.01, 0]} />
			<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
				<planeGeometry args={[72, 72]} />
				<meshStandardMaterial color="#0c111a" roughness={1} metalness={0} />
			</mesh>

			<GraphEdges edges={edges} byId={byId} poses={poses} selectedId={selectedId} pinId={pinId} />
			{laid.map((n) => {
				const away = Boolean(parked[n.id] || snaps[n.id]);
				return (
					<group key={n.id}>
						{away && <GhostSlot node={n} />}
						<GraphBox
							node={n}
							selected={selectedId === n.id}
							hovered={hoverId === n.id}
							dimmed={Boolean(selectedId && n.id !== selectedId && n.id !== hoverId)}
							showLabel={
								n.id === selectedId ||
								n.id === hoverId ||
								n.id === focusId ||
								Boolean(parked[n.id]) ||
								laid.length <= 8
							}
							parked={Boolean(parked[n.id])}
							pose={poses[n.id] ?? toWorld(n)}
							onSelect={onSelect}
							onEnter={onEnter}
							onHover={onHover}
							onDragStart={startDrag}
							onMenu={onMenu}
							onRemove={onRemove}
							isPin={n.id === pinId}
						/>
					</group>
				);
			})}

			<CameraRig focus={focus ?? null} laid={laid} mode={frameMode} flyToken={flyToken} />
			<OrbitControls
				makeDefault
				enableDamping
				dampingFactor={0.08}
				enabled={!draggingId}
				minDistance={8}
				maxDistance={90}
				minPolarAngle={0.28}
				maxPolarAngle={Math.PI / 2.25}
				mouseButtons={{ LEFT: 2, MIDDLE: 1, RIGHT: 0 }}
			/>
		</>
	);
}

export function GraphWorld({
	nodes,
	edges,
	selectedId,
	focusId,
	onSelect,
	onEnter,
	catalog,
	onAdd,
}: {
	nodes: CaseNetworkNode[];
	edges: CaseNetworkEdge[];
	selectedId: string | null;
	focusId?: string | null;
	onSelect: (id: string | null) => void;
	onEnter?: (node: CaseNetworkNode) => void;
	catalog?: CaseNetworkNode[];
	onAdd?: (id: string) => void;
}) {
	const [mounted, setMounted] = useState(false);
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [flyToken, setFlyToken] = useState(0);
	const [frameMode, setFrameMode] = useState<"overview" | "node">("overview");
	const [help, setHelp] = useState(true);
	const [parked, setParked] = useState<Parked>({});
	const [parkedCount, setParkedCount] = useState(0);
	const [snapAllToken, setSnapAllToken] = useState(0);
	const [snapTarget, setSnapTarget] = useState<string | null>(null);
	const [hiddenIds, setHiddenIds] = useState<string[]>([]);
	const [menu, setMenu] = useState<{
		id: string;
		x: number;
		y: number;
	} | null>(null);
	const [angles, setAngles] = useState<Record<string, number>>({});
	const [query, setQuery] = useState("");
	const [hintOpen, setHintOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setMounted(true);
		try {
			setHintOpen(localStorage.getItem("eye.board.hinted") !== "1");
		} catch {
			setHintOpen(true);
		}
	}, []);

	useEffect(() => {
		if (mounted) wrapRef.current?.focus();
	}, [mounted]);

	const visibleNodes = useMemo(
		() => nodes.filter((n) => !hiddenIds.includes(n.id) || n.id === focusId),
		[nodes, hiddenIds, focusId],
	);
	const visibleIdSet = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
	const visibleEdges = useMemo(
		() => edges.filter((e) => visibleIdSet.has(e.source) && visibleIdSet.has(e.target)),
		[edges, visibleIdSet],
	);
	const pinId =
		selectedId && visibleIdSet.has(selectedId) ? selectedId : focusId ?? null;
	const laid = useMemo(
		() => layoutNodes(visibleNodes, pinId, angles),
		[visibleNodes, pinId, angles],
	);
	const hoverNode = hoverId ? laid.find((n) => n.id === hoverId) : null;
	const selectedNode = selectedId ? laid.find((n) => n.id === selectedId) : null;

	useEffect(() => {
		setFrameMode("overview");
		setFlyToken((n) => n + 1);
		setParked({});
		setHiddenIds([]);
		setAngles({});
		setMenu(null);
	}, [focusId]);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onSelect(null);
				return;
			}
			if (e.key === "Enter" && selectedNode) {
				onEnter?.(selectedNode);
				return;
			}
			if (e.key === "f" || e.key === "F") {
				setFrameMode(selectedId ? "node" : "overview");
				setFlyToken((n) => n + 1);
				return;
			}
			if (e.key === "o" || e.key === "O") {
				setFrameMode("overview");
				setFlyToken((n) => n + 1);
				return;
			}
			if (e.key === "j" || e.key === "ArrowRight") {
				e.preventDefault();
				const i = laid.findIndex((n) => n.id === (selectedId ?? focusId));
				const next = laid[(i + 1 + laid.length) % laid.length];
				if (next) onSelect(next.id);
			}
			if (e.key === "k" || e.key === "ArrowLeft") {
				e.preventDefault();
				const i = laid.findIndex((n) => n.id === (selectedId ?? focusId));
				const prev = laid[(i - 1 + laid.length) % laid.length];
				if (prev) onSelect(prev.id);
			}
		};
		el.addEventListener("keydown", onKey);
		return () => el.removeEventListener("keydown", onKey);
	}, [laid, selectedId, focusId, selectedNode, onSelect, onEnter]);

	if (!mounted) {
		return (
			<div className="h-full w-full flex items-center justify-center bg-surface-container-lowest">
				<span className="font-mono text-body text-outline">LOADING_WORLD</span>
			</div>
		);
	}

	return (
		<div
			ref={wrapRef}
			tabIndex={0}
			className="relative h-full w-full min-h-0 bg-surface-container-lowest outline-none"
			aria-label="Case network 3D view. Click a structure to inspect. Double-click to go inside. Right-click for menu."
			onContextMenu={(e) => e.preventDefault()}
			onPointerDown={() => {
				if (menu) setMenu(null);
			}}
		>
			<div className="sr-only" aria-live="polite">
				{selectedNode
					? `Selected ${selectedNode.kind.replace(/_/g, " ")} ${selectedNode.label}`
					: "No structure selected"}
			</div>
			<Canvas
				shadows
				dpr={[1, 1.6]}
				gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
				camera={{ position: [32, 24, 32], fov: 42, near: 0.2, far: 220 }}
				onPointerMissed={() => {
					onSelect(null);
					setMenu(null);
				}}
			>
				<SceneBody
					laid={laid}
					edges={visibleEdges}
					selectedId={selectedId}
					focusId={focusId}
					onSelect={onSelect}
					onEnter={onEnter}
					onHover={setHoverId}
					hoverId={hoverId}
					flyToken={flyToken}
					frameMode={frameMode}
					parked={parked}
					setParked={setParked}
					snapAllToken={snapAllToken}
					snapTarget={snapTarget}
					onParkedCount={setParkedCount}
					onMenu={(node, x, y) => {
						onSelect(node.id);
						const pad = 8;
						const w = 220;
						const h = 168;
						setMenu({
							id: node.id,
							x: Math.min(x, window.innerWidth - w - pad),
							y: Math.min(y, window.innerHeight - h - pad),
						});
					}}
					onSetAngle={(id, theta) => {
						setAngles((a) => ({ ...a, [id]: theta }));
					}}
					onRemove={(id) => {
						if (id === focusId) return;
						setHiddenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
						if (selectedId === id) onSelect(null);
					}}
					pinId={pinId}
				/>
			</Canvas>

			{menu && (
				<div
					className="fixed z-50 w-[220px] border border-outline/40 bg-surface-container-high/95 backdrop-blur-xl"
					style={{ left: menu.x, top: menu.y }}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div className="px-3 py-2 border-b border-outline-variant/20">
						<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
							{(laid.find((n) => n.id === menu.id)?.kind ?? "node").replace(/_/g, " ")}
						</div>
						<div className="font-mono text-body text-on-surface truncate">
							{laid.find((n) => n.id === menu.id)?.label ?? menu.id}
						</div>
					</div>
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="w-full justify-start rounded-none text-meta"
						onClick={() => {
							const n = laid.find((x) => x.id === menu.id);
							setMenu(null);
							if (n) onEnter?.(n);
						}}
					>
						GO_INSIDE
					</Button>
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="w-full justify-start rounded-none text-meta"
						onClick={() => {
							setFrameMode("node");
							setFlyToken((n) => n + 1);
							setMenu(null);
						}}
					>
						FRAME
					</Button>
					{parked[menu.id] && (
						<Button
							variant="ghost"
							size="sm"
							brackets={false}
							className="w-full justify-start rounded-none text-meta"
							onClick={() => {
								setSnapTarget(menu.id);
								setMenu(null);
							}}
						>
							SNAP_HOME
						</Button>
					)}
					{menu.id !== focusId && (
						<Button
							variant="ghost"
							size="sm"
							brackets={false}
							className="w-full justify-start rounded-none text-meta text-destructive/80 hover:text-destructive"
							onClick={() => {
								setHiddenIds((ids) => (ids.includes(menu.id) ? ids : [...ids, menu.id]));
								if (selectedId === menu.id) onSelect(null);
								setParked((p) => {
									const next = { ...p };
									delete next[menu.id];
									return next;
								});
								setMenu(null);
							}}
						>
							REMOVE_FROM_VIEW
						</Button>
					)}
				</div>
			)}

			<div className="absolute left-4 top-4 w-72 space-y-2 pointer-events-none">
				{(hoverNode || selectedNode) && (
					<div className="pointer-events-none border border-outline-variant/40 bg-surface/90 px-3 py-2">
						<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
							{typeLabel((hoverNode ?? selectedNode)!)}
						</div>
						<div className="font-mono text-body-lg text-on-surface">
							{(hoverNode ?? selectedNode)!.label}
						</div>
						{(hoverNode ?? selectedNode)!.sublabel && (
							<div className="font-mono text-meta text-outline">
								{(hoverNode ?? selectedNode)!.sublabel}
							</div>
						)}
						<div className="font-mono text-meta tabular-nums text-outline mt-1">
							RELEVANCE {Math.round(((hoverNode ?? selectedNode)!.relevanceToFocus ?? (hoverNode ?? selectedNode)!.importance ?? 0) * 100)}
						</div>
					</div>
				)}
				<div className="pointer-events-auto">
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Add an entity to the board…"
						className="w-full bg-surface border border-outline text-foreground font-mono text-body px-3 py-2 focus:outline-none focus:border-primary/50"
					/>
					{query.trim().length >= 2 && (
						<div className="border border-outline-variant/40 bg-surface-container-high mt-1 max-h-40 overflow-y-auto">
							{(catalog ?? nodes)
								.filter((n) => {
									const q = query.trim().toLowerCase();
									return (
										n.label.toLowerCase().includes(q) ||
										(n.normalizedName ?? "").includes(q)
									);
								})
								.slice(0, 8)
								.map((n) => (
									<Button
										key={n.id}
										variant="ghost"
										size="sm"
										brackets={false}
										className="w-full justify-start rounded-none text-meta"
										onClick={() => {
											if (hiddenIds.includes(n.id)) {
												setHiddenIds((ids) => ids.filter((id) => id !== n.id));
											} else if (!visibleIdSet.has(n.id)) {
												onAdd?.(n.id);
											}
											onSelect(n.id);
											setQuery("");
										}}
									>
										{n.label}
									</Button>
								))}
						</div>
					)}
				</div>
			</div>

			<div className="absolute right-3 top-3 flex flex-col gap-1">
				<Button
					variant="ghost"
					size="sm"
					brackets={false}
					className="text-meta h-7"
					onClick={() => {
						setFrameMode(selectedId ? "node" : "overview");
						setFlyToken((n) => n + 1);
					}}
				>
					FRAME
				</Button>
				<Button
					variant="ghost"
					size="sm"
					brackets={false}
					className="text-meta h-7"
					onClick={() => {
						setFrameMode("overview");
						setFlyToken((n) => n + 1);
					}}
				>
					OVERVIEW
				</Button>
				{parkedCount > 0 && (
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="text-meta h-7 text-primary/80"
						onClick={() => setSnapAllToken((n) => n + 1)}
					>
						SNAP_HOME
					</Button>
				)}
				{hiddenIds.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="text-meta h-7 text-primary/80"
						onClick={() => setHiddenIds([])}
					>
						RESTORE ({hiddenIds.length})
					</Button>
				)}
				{(Object.keys(angles).length > 0 || parkedCount > 0) && (
					<Button
						variant="ghost"
						size="sm"
						brackets={false}
						className="text-meta h-7"
						onClick={() => {
							setAngles({});
							setParked({});
							setSnapAllToken((n) => n + 1);
						}}
					>
						RESTORE_LAYOUT
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					brackets={false}
					className="text-meta h-7"
					onClick={() => setHelp((h) => !h)}
				>
					KEYS
				</Button>
			</div>

			<div className="absolute left-4 bottom-10 max-w-sm border border-outline-variant/30 bg-surface/85 px-3 py-2">
				<div className="font-mono text-meta uppercase tracking-[0.12em] text-outline mb-1">
					HOW TO READ THIS BOARD
				</div>
				<p className="font-mono text-meta text-on-surface leading-relaxed">
					Closer = more connected to{" "}
					<span className="text-primary">
						{laid.find((n) => n.id === pinId)?.label ?? "the pinned entity"}
					</span>
					. Bigger = mentioned more often. Brighter = stronger evidence. Amber
					rounded = person. Violet cube = role/org. Cyan prism = case. Teal slab =
					document.
				</p>
			</div>

			{hintOpen && (
				<div className="absolute inset-x-0 bottom-24 z-40 flex justify-center pointer-events-none">
					<div className="pointer-events-auto border border-primary/30 bg-surface/95 px-4 py-3 max-w-lg">
						<p className="font-mono text-body text-on-surface reading mb-2">
							Click an entity to pin it at the center. Closer means more
							connected. Drag to explore. Right-click to remove from view.
						</p>
						<Button
							variant="ghost"
							size="sm"
							brackets={false}
							className="text-meta"
							onClick={() => {
								setHintOpen(false);
								try {
									localStorage.setItem("eye.board.hinted", "1");
								} catch {
									/* ignore */
								}
							}}
						>
							GOT_IT
						</Button>
					</div>
				</div>
			)}

			<div className="absolute left-0 right-0 bottom-0 px-4 py-1.5 border-t border-outline-variant/20 bg-surface/85">
				<span className="font-mono text-meta uppercase tracking-[0.12em] text-outline">
					{help
						? "CLICK TO PIN · RIGHT-CLICK TO REMOVE · TYPE TO ADD · DRAG TO PARK · DROP TO SETTLE · O OVERVIEW"
						: `${laid.length} ENTITIES · ${visibleEdges.length} CONNECTIONS · CLOSER = MORE RELEVANT`}
				</span>
			</div>
		</div>
	);
}
