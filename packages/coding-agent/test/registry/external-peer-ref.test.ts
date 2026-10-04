/**
 * External peers in the agent roster: a session-less `external` ref is a
 * first-class roster entry, but it is never corroborated as locally running and
 * never claims a session file.
 */
import { describe, expect, it } from "bun:test";
import { AgentRegistry, isLocalAgentRef } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";

const PEER_ID = "peer@dev2";

function registerPeer(registry: AgentRegistry, overrides: Record<string, unknown> = {}) {
	return registry.register({
		id: PEER_ID,
		displayName: "dev2",
		kind: "external",
		session: null,
		sessionFile: null,
		status: "running",
		activity: "editing src/index.ts",
		...overrides,
	});
}

describe("external peer refs", () => {
	it("registers without a local session and accepts peer-driven status and activity", () => {
		const registry = new AgentRegistry();
		const events: string[] = [];
		registry.onChange(event => events.push(event.type));
		const peer = registerPeer(registry);

		expect(peer.kind).toBe("external");
		expect(peer.session).toBeNull();
		expect(peer.sessionFile).toBeNull();
		expect(registry.list()).toEqual([peer]);

		// The peer's heartbeat is the only liveness signal this process has.
		expect(registry.setStatus(PEER_ID, "idle")).toBe(true);
		expect(peer.status).toBe("idle");
		// Activity is a running gist: leaving `running` drops it, so a roster
		// never shows a peer's stale work.
		registry.setActivity(PEER_ID, "blocked: awaiting input");
		expect(peer.activity).toBeUndefined();
		expect(registry.setStatus(PEER_ID, "running")).toBe(true);
		registry.setActivity(PEER_ID, "blocked: awaiting input");
		expect(peer.activity).toBe("blocked: awaiting input");
		expect(events).toEqual(["registered", "status_changed", "status_changed"]);

		expect(registry.unregister(PEER_ID)).toBe(true);
		expect(registry.list()).toEqual([]);
	});

	it("is never reported as locally running, however it reports itself", () => {
		const registry = new AgentRegistry();
		const peer = registerPeer(registry);
		// `isRunning` means "a live attached session corroborates the claim"; the
		// local-only paths behind it (`agent://` supersede, job control) must not
		// start treating a foreign process as one of ours.
		expect(registry.isRunning(peer)).toBe(false);
		registry.setStatus(PEER_ID, "idle");
		expect(registry.isRunning(peer)).toBe(false);
	});

	it("is never addressable as a local peer: not listed to agents, not a local ref", () => {
		const registry = new AgentRegistry();
		const peer = registerPeer(registry);

		// Agent-facing rosters (`agent://` targeting, the peer roster, broadcast)
		// must not advertise a recipient this process cannot deliver to.
		expect(registry.listVisibleTo("Main")).toEqual([]);
		expect(isLocalAgentRef(peer)).toBe(false);
	});

	it("lets a returning peer reclaim its parked id, and only that generation", () => {
		const registry = new AgentRegistry();
		const peer = registerPeer(registry);
		registry.setStatus(PEER_ID, "parked");

		// The peer came back: `registerIfAvailable` hands the caller the same
		// parked, session-less generation to bring live — it does not re-register.
		const revived = registry.registerIfAvailable(
			{ id: PEER_ID, displayName: "dev2", kind: "external", session: null, status: "running" },
			peer,
		);
		expect(revived).toBe(peer);
		expect(revived?.status).toBe("parked");
		expect(registry.setStatus(PEER_ID, "running", peer)).toBe(true);
		expect(peer.status).toBe("running");

		// A stale reviver holding a ref that was already replaced is refused.
		registry.unregister(PEER_ID);
		registerPeer(registry);
		expect(
			registry.registerIfAvailable({ id: PEER_ID, displayName: "dev2", kind: "external", session: null }, peer),
		).toBeUndefined();
	});
});
