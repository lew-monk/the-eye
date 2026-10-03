/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { liveFileStates, useJobEvents } from "./use-job-events";

type Listener = (event: { data: string }) => void;

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}

	emitOpen() {
		this.onopen?.();
	}

	emitMessage(data: string) {
		this.onmessage?.({ data });
	}

	emitError() {
		this.onerror?.();
	}

	close() {
		this.closed = true;
	}

	addEventListener(_type: string, _listener: Listener) {}
	removeEventListener(_type: string, _listener: Listener) {}
}

vi.stubGlobal("EventSource", FakeEventSource);

afterEach(() => {
	FakeEventSource.instances = [];
	vi.useRealTimers();
});

describe("useJobEvents — live SSE with resume", () => {
	test("connects to the job stream and appends parsed events", () => {
		const { result } = renderHook(() => useJobEvents("job-1"));
		const source = FakeEventSource.instances[0];
		expect(source?.url).toBe("/api/ingestion/job-1/events?after=0");

		act(() => {
			source?.emitOpen();
			source?.emitMessage(
				JSON.stringify({ seq: 1, kind: "file-done", checksum: "a" }),
			);
		});

		expect(result.current.live).toBe(true);
		expect(result.current.events).toHaveLength(1);
		expect(result.current.events[0]?.kind).toBe("file-done");
	});

	test("duplicate seqs are ignored (reconnect replay safety)", () => {
		const { result } = renderHook(() => useJobEvents("job-1"));
		const source = FakeEventSource.instances[0];

		act(() => {
			source?.emitOpen();
			source?.emitMessage(JSON.stringify({ seq: 1, kind: "a" }));
			source?.emitMessage(JSON.stringify({ seq: 1, kind: "a" }));
			source?.emitMessage(JSON.stringify({ seq: 0, kind: "stale" }));
		});

		expect(result.current.events).toHaveLength(1);
	});

	test("malformed frames never crash the hook", () => {
		const { result } = renderHook(() => useJobEvents("job-1"));
		const source = FakeEventSource.instances[0];

		act(() => {
			source?.emitOpen();
			source?.emitMessage("not-json{{{");
			source?.emitMessage(JSON.stringify({ kind: "no-seq" }));
		});

		expect(result.current.events).toHaveLength(0);
	});

	test("error closes the stream and drops to non-live (polling fallback)", () => {
		const { result } = renderHook(() => useJobEvents("job-1"));
		const source = FakeEventSource.instances[0];

		act(() => {
			source?.emitOpen();
		});
		expect(result.current.live).toBe(true);

		act(() => {
			source?.emitError();
		});
		expect(source?.closed).toBe(true);
		expect(result.current.live).toBe(false);
	});

	test("unmount closes the connection (no leaked EventSource)", () => {
		const { unmount } = renderHook(() => useJobEvents("job-1"));
		const source = FakeEventSource.instances[0];

		unmount();
		expect(source?.closed).toBe(true);
	});

	test("null jobId never connects", () => {
		renderHook(() => useJobEvents(null));
		expect(FakeEventSource.instances).toHaveLength(0);
	});

	test("jobId change resets events and reconnects with after=0", () => {
		const { result, rerender } = renderHook(
			({ jobId }: { jobId: string }) => useJobEvents(jobId),
			{ initialProps: { jobId: "job-1" } },
		);
		const first = FakeEventSource.instances[0];
		act(() => {
			first?.emitOpen();
			first?.emitMessage(JSON.stringify({ seq: 1, kind: "a" }));
		});
		expect(result.current.events).toHaveLength(1);

		rerender({ jobId: "job-2" });
		expect(result.current.events).toHaveLength(0);
		const second =
			FakeEventSource.instances[FakeEventSource.instances.length - 1];
		expect(second?.url).toBe("/api/ingestion/job-2/events?after=0");
	});
});

describe("liveFileStates — per-file overlay", () => {
	test("keeps only the latest event per checksum", () => {
		const states = liveFileStates([
			{ seq: 1, kind: "file-progress", checksum: "a", stage: "ocr" },
			{ seq: 2, kind: "file-progress", checksum: "a", stage: "embedded" },
			{ seq: 3, kind: "file-done", checksum: "b" },
			{ seq: 4, kind: "job-started" },
		]);
		expect(states.get("a")?.stage).toBe("embedded");
		expect(states.get("b")?.kind).toBe("file-done");
		expect(states.has("job-started")).toBe(false);
		expect(states.size).toBe(2);
	});
});
