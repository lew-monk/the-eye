import { useEffect, useRef, useState } from "react";

export interface StreamedJobEvent {
	seq: number;
	kind: string;
	relativePath?: string;
	checksum?: string;
	stage?: string;
	pct?: number;
	error?: string;
	at?: string;
}

interface UseJobEventsResult {
	events: StreamedJobEvent[];
	/** True while the EventSource is open; false before connect or after fallback. */
	live: boolean;
}

const MAX_EVENTS = 500;

function parseEvent(data: string): StreamedJobEvent | null {
	try {
		const parsed = JSON.parse(data) as Partial<StreamedJobEvent>;
		if (typeof parsed.seq !== "number" || typeof parsed.kind !== "string") {
			return null;
		}
		return parsed as StreamedJobEvent;
	} catch {
		return null;
	}
}

/**
 * Live job events over SSE (`/api/ingestion/:jobId/events`), with resume
 * from the last seen seq on reconnect. On stream error the hook goes
 * non-live so callers can fall back to polling — never wedged open.
 */
export function useJobEvents(
	jobId: string | null,
	options: { enabled?: boolean } = {},
): UseJobEventsResult {
	const enabled = options.enabled ?? jobId !== null;
	const [events, setEvents] = useState<StreamedJobEvent[]>([]);
	const [live, setLive] = useState(false);
	const seqRef = useRef(0);
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	useEffect(() => {
		// Reset first so the new connection starts from ?after=0.
		seqRef.current = 0;
		setEvents([]);
		if (!enabledRef.current || !jobId) return;
		let disposed = false;
		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

		const connect = () => {
			if (disposed) return;
			source = new EventSource(
				`/api/ingestion/${encodeURIComponent(jobId)}/events?after=${seqRef.current}`,
			);
			source.onopen = () => {
				if (!disposed) setLive(true);
			};
			source.onmessage = (message) => {
				const event = parseEvent(message.data);
				if (!event || event.seq <= seqRef.current) return;
				seqRef.current = event.seq;
				setEvents((prev) => {
					if (prev.some((e) => e.seq === event.seq)) return prev;
					const next = [...prev, event].sort((a, b) => a.seq - b.seq);
					return next.length > MAX_EVENTS
						? next.slice(next.length - MAX_EVENTS)
						: next;
				});
			};
			source.onerror = () => {
				source?.close();
				source = null;
				if (disposed) return;
				setLive(false);
				// One resume attempt with ?after= cursor; polling covers the rest.
				reconnectTimer = setTimeout(connect, 2000);
			};
		};

		connect();
		return () => {
			disposed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			source?.close();
			source = null;
			setLive(false);
		};
	}, [jobId]);

	return { events, live };
}

/** Latest live event per file checksum (for overlaying onto polled rows). */
export function liveFileStates(
	events: StreamedJobEvent[],
): Map<string, StreamedJobEvent> {
	const states = new Map<string, StreamedJobEvent>();
	for (const event of events) {
		if (!event.checksum) continue;
		const current = states.get(event.checksum);
		if (!current || event.seq > current.seq) {
			states.set(event.checksum, event);
		}
	}
	return states;
}
