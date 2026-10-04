/**
 * Contract: a top-level session hands extensions the owner-scoped surfaces
 * (`ctx.asyncJobs`, `ctx.externalAgents`), and a peer published through
 * `ctx.externalAgents` becomes a Hub roster row — session-less, invisible to
 * agent-facing rosters — that the session's teardown drops. A subagent session
 * gets no peer surface at all: peers are a top-level notion.
 *
 * Both surfaces are built eagerly during session creation, so a guard reading
 * session state that does not exist yet would silently disable the feature;
 * this drives the real `createAgentSession` → `ExtensionRunner` → `ctx` path
 * rather than asserting the wiring through mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ExtensionFactory } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { removeSyncWithRetries } from "@oh-my-pi/pi-utils";

const PEER_ID = "peer@dev2";
const tempDirs: string[] = [];
let sharedTempDir: string;
let sharedAuthStorage: AuthStorage;
let sharedModelRegistry: ModelRegistry;

beforeAll(async () => {
	// One network-free registry shared by both sessions: model resolution is the
	// dominant cost here and is unrelated to the surfaces under test.
	sharedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-surfaces-"));
	sharedAuthStorage = await AuthStorage.create(path.join(sharedTempDir, "auth.db"));
	sharedModelRegistry = new ModelRegistry(sharedAuthStorage, path.join(sharedTempDir, "models.yml"));
});

afterAll(() => {
	sharedAuthStorage.close();
	removeSyncWithRetries(sharedTempDir);
});

/** What the publishing extension observed at session-shutdown time. */
interface Observed {
	hasPeerSurface: boolean;
	hasJobSurface: boolean;
	rowKind: string | undefined;
	rowIsSessionless: boolean;
	rowActivity: string | undefined;
	rowListedToMain: boolean;
}

/**
 * Publishes one peer on `session_shutdown` — the last hook that still receives a
 * live context — and records what the shared registry looked like there.
 */
function makePublisher(observed: Partial<Observed>): ExtensionFactory {
	return pi => {
		pi.on("session_shutdown", (_event, ctx) => {
			observed.hasPeerSurface = ctx.externalAgents !== undefined;
			observed.hasJobSurface = ctx.asyncJobs !== undefined;
			ctx.externalAgents?.upsert({
				id: PEER_ID,
				displayName: "dev2",
				status: "running",
				activity: "editing src/index.ts",
			});
			const row = AgentRegistry.global().get(PEER_ID);
			observed.rowKind = row?.kind;
			observed.rowIsSessionless = row?.session === null;
			observed.rowActivity = row?.activity;
			observed.rowListedToMain = AgentRegistry.global()
				.listVisibleTo("Main")
				.some(ref => ref.id === PEER_ID);
		});
	};
}

async function spawnSession(options: {
	observed: Partial<Observed>;
	taskDepth?: number;
	agentId?: string;
}): Promise<AgentSession> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-surfaces-session-"));
	tempDirs.push(tempDir);
	const { session } = await createAgentSession({
		cwd: tempDir,
		agentDir: tempDir,
		settings: Settings.isolated({ "compaction.enabled": false }),
		disableExtensionDiscovery: true,
		extensions: [makePublisher(options.observed)],
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		modelRegistry: sharedModelRegistry,
		...(options.taskDepth === undefined ? {} : { taskDepth: options.taskDepth }),
		...(options.agentId === undefined ? {} : { agentId: options.agentId }),
	});
	return session;
}

describe("owner-scoped extension surfaces at session creation", () => {
	it("publishes an external peer through ctx.externalAgents and drops it on dispose", async () => {
		const observed: Partial<Observed> = {};
		const session = await spawnSession({ observed });
		try {
			await session.dispose();
		} finally {
			for (const dir of tempDirs.splice(0)) removeSyncWithRetries(dir);
		}

		expect(observed.hasPeerSurface).toBe(true);
		expect(observed.hasJobSurface).toBe(true);
		expect(observed.rowKind).toBe("external");
		expect(observed.rowIsSessionless).toBe(true);
		expect(observed.rowActivity).toBe("editing src/index.ts");
		// A peer is a Hub row, never an addressable agent: it must not show up in
		// the rosters agent:// targeting, broadcast, and collab guests read.
		expect(observed.rowListedToMain).toBe(false);
		// Session teardown drops the publisher's rows: no ghosts in the shared registry.
		expect(AgentRegistry.global().get(PEER_ID)).toBeUndefined();
	}, 60_000);

	it("gives a subagent session no peer surface, so nothing is published", async () => {
		const observed: Partial<Observed> = {};
		const session = await spawnSession({ observed, taskDepth: 1, agentId: "SubAgent" });
		try {
			await session.dispose();
		} finally {
			for (const dir of tempDirs.splice(0)) removeSyncWithRetries(dir);
		}

		expect(observed.hasPeerSurface).toBe(false);
		expect(AgentRegistry.global().get(PEER_ID)).toBeUndefined();
	}, 60_000);
});
