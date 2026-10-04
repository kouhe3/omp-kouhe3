/**
 * Scoped roster surface: what a plugin may publish, whose rows it may drive, and
 * what must never happen — taking over a local agent's id, or driving a peer
 * another scope published.
 */
import { describe, expect, it } from "bun:test";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { createScopedExternalAgents } from "@oh-my-pi/pi-coding-agent/registry/external-agents";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

function withLocalMain(registry: AgentRegistry): void {
	registry.register({
		id: "Main",
		displayName: "Main",
		kind: "main",
		session: { subscribe: () => () => {} } as unknown as AgentSession,
		status: "idle",
	});
}

describe("scoped external agents", () => {
	it("publishes a session-less peer row with the publisher's status and activity", () => {
		const registry = new AgentRegistry();
		const peers = createScopedExternalAgents(registry, "Main");

		peers.upsert({
			id: "peer@dev2",
			displayName: "dev2",
			status: "running",
			activity: "editing src/index.ts",
			sessionFile: null,
		});

		const ref = registry.get("peer@dev2");
		expect(ref?.kind).toBe("external");
		expect(ref?.session).toBeNull();
		expect(ref?.sessionFile).toBeNull();
		expect(ref?.status).toBe("running");
		expect(ref?.activity).toBe("editing src/index.ts");

		// Re-announcing the same peer refreshes one row instead of forking a second.
		peers.upsert({ id: "peer@dev2", displayName: "dev2 (rebooted)", status: "idle" });
		expect(registry.list().filter(entry => entry.id === "peer@dev2")).toHaveLength(1);
		expect(registry.get("peer@dev2")?.displayName).toBe("dev2 (rebooted)");
		expect(registry.get("peer@dev2")?.status).toBe("idle");
		// Leaving `running` drops the gist, so the roster never shows stale work.
		expect(registry.get("peer@dev2")?.activity).toBeUndefined();
	});

	it("refuses to take over an id a local agent owns", () => {
		const registry = new AgentRegistry();
		withLocalMain(registry);
		const peers = createScopedExternalAgents(registry, "Main");

		peers.upsert({ id: "Main", displayName: "hijacked", status: "running", activity: "not really" });

		const main = registry.get("Main");
		expect(main?.kind).toBe("main");
		expect(main?.displayName).toBe("Main");
		expect(main?.session).not.toBeNull();
	});

	it("drives only the rows it published", () => {
		const registry = new AgentRegistry();
		withLocalMain(registry);
		const mine = createScopedExternalAgents(registry, "Main");
		const other = createScopedExternalAgents(registry, "Other");
		mine.upsert({ id: "peer@dev2", displayName: "dev2", status: "running", activity: "building" });
		other.upsert({ id: "peer@dev3", displayName: "dev3", status: "running" });

		expect(other.setStatus("peer@dev2", "parked")).toBe(false);
		other.setActivity("peer@dev2", "spoofed");
		expect(registry.get("peer@dev2")?.status).toBe("running");
		expect(registry.get("peer@dev2")?.activity).toBe("building");

		// A local agent is not a peer row either, however it is addressed.
		expect(other.setStatus("Main", "parked")).toBe(false);
		expect(registry.get("Main")?.status).toBe("idle");

		expect(mine.setStatus("peer@dev2", "parked")).toBe(true);
		expect(registry.get("peer@dev2")?.status).toBe("parked");
		expect(mine.remove("peer@dev2")).toBe(true);
		expect(registry.get("peer@dev2")).toBeUndefined();
		expect(other.remove("peer@dev2")).toBe(false);
	});

	it("drops every published row on dispose without touching anyone else's", () => {
		const registry = new AgentRegistry();
		withLocalMain(registry);
		const mine = createScopedExternalAgents(registry, "Main");
		const other = createScopedExternalAgents(registry, "Other");
		mine.upsert({ id: "peer@dev2", displayName: "dev2" });
		mine.upsert({ id: "peer@dev3", displayName: "dev3" });
		other.upsert({ id: "peer@dev4", displayName: "dev4" });

		mine.dispose();

		expect(
			registry
				.list()
				.map(entry => entry.id)
				.sort(),
		).toEqual(["Main", "peer@dev4"]);
		expect(other.setStatus("peer@dev4", "idle")).toBe(true);
	});
});
