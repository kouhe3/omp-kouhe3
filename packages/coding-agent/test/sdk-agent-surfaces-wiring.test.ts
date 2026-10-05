/**
 * Contract: a top-level session hands extensions the owner-scoped
 * `ctx.asyncJobs` surface. It is built eagerly during session creation, so a
 * guard reading session state that does not exist yet would silently disable
 * the feature; this drives the real `createAgentSession` → `ExtensionRunner` →
 * `ctx` path rather than asserting the wiring through mocks.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ExtensionFactory } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { removeSyncWithRetries } from "@oh-my-pi/pi-utils";

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

/** What the probing extension observed at session-shutdown time. */
interface Observed {
	hasJobSurface: boolean;
}

/** Probes the context on `session_shutdown` — the last hook that still receives a live context. */
function makePublisher(observed: Partial<Observed>): ExtensionFactory {
	return pi => {
		pi.on("session_shutdown", (_event, ctx) => {
			observed.hasJobSurface = ctx.asyncJobs !== undefined;
		});
	};
}

async function spawnSession(observed: Partial<Observed>): Promise<AgentSession> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-surfaces-session-"));
	tempDirs.push(tempDir);
	const { session } = await createAgentSession({
		cwd: tempDir,
		agentDir: tempDir,
		settings: Settings.isolated({ "compaction.enabled": false }),
		disableExtensionDiscovery: true,
		extensions: [makePublisher(observed)],
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		modelRegistry: sharedModelRegistry,
	});
	return session;
}

describe("owner-scoped extension surfaces at session creation", () => {
	it("hands an extension the owner-scoped job surface on a real session", async () => {
		const observed: Partial<Observed> = {};
		const session = await spawnSession(observed);
		try {
			await session.dispose();
		} finally {
			for (const dir of tempDirs.splice(0)) removeSyncWithRetries(dir);
		}

		expect(observed.hasJobSurface).toBe(true);
	}, 60_000);
});
