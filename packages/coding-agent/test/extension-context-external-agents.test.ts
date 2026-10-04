/**
 * The scoped roster surface must actually reach extension contexts: a peer
 * publisher gets it from `ctx.externalAgents`, and what it publishes is a
 * read-only roster row — never a locally running agent.
 */
import { describe, expect, it } from "bun:test";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type { ExtensionRuntime } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	createScopedExternalAgents,
	type ScopedExternalAgents,
} from "@oh-my-pi/pi-coding-agent/registry/external-agents";

function createRunner(peers?: ScopedExternalAgents): ExtensionRunner {
	const runtime = {
		flagValues: new Map(),
		pendingProviderRegistrations: [],
	} as unknown as ExtensionRuntime;
	return new ExtensionRunner(
		[],
		runtime,
		"/tmp",
		{ getCwd: () => "/tmp" } as never,
		{} as never,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		peers,
	);
}

describe("ExtensionRunner external agent context", () => {
	it("is absent without a session", () => {
		expect(createRunner().createContext().externalAgents).toBeUndefined();
	});

	it("publishes read-only roster rows through the context", () => {
		const registry = new AgentRegistry();
		const peers = createScopedExternalAgents(registry, "Main");
		const ctx = createRunner(peers).createContext();

		expect(ctx.externalAgents).toBe(peers);
		ctx.externalAgents?.upsert({
			id: "peer@dev2",
			displayName: "dev2",
			status: "running",
			activity: "building",
		});

		const ref = registry.get("peer@dev2");
		expect(ref?.kind).toBe("external");
		expect(ref?.session).toBeNull();
		expect(ref?.displayName).toBe("dev2");
		// No local session corroborates it, so the local-only paths behind
		// `isRunning` (agent:// supersede checks, job control) stay closed.
		expect(registry.isRunning(ref!)).toBe(false);
	});
});
