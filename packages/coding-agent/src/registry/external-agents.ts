/**
 * Owner-scoped roster surface for agents running outside this process.
 *
 * A peer (another omp on this machine, another host, another harness) publishes
 * itself here so it shows up in the Hub roster with its own status and activity
 * instead of being invisible. The surface is deliberately narrow:
 *
 * - Every row it creates is `kind: "external"` with `session: null`; a publisher
 *   cannot mint a `main`/`sub`/`advisor` row, and cannot take over an id a local
 *   agent already owns (the Hub's `Main` is the obvious target).
 * - `setStatus`/`setActivity`/`remove` only act on rows the same scope
 *   published, so one extension cannot drive another's peers — or the local
 *   roster. A scope claims the ids it announced: `upsert` refreshes those rows
 *   in place and refuses an id another scope already published as a peer, so a
 *   second extension can neither forge nor adopt (and then remove) them.
 * - Nothing here gives control over the peer. It is a *roster* surface: the
 *   registry never focuses, kills, or revives an external row, and `isRunning`
 *   stays false for it because no local session corroborates the claim.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { AgentRegistry, type AgentHistorySummary, type AgentStatus, type AgentRef } from "./agent-registry";

/** What a publisher supplies when announcing a peer. */
export interface ExternalAgentInput {
	/** Roster id. Must not collide with a local agent's id. */
	id: string;
	displayName: string;
	/** Peer-reported state; defaults to `running` while it is connected. */
	status?: AgentStatus;
	/** What the peer is doing right now (its own gist). */
	activity?: string;
	parentId?: string;
	/**
	 * The peer's session file, when this host can read it (another local omp).
	 * The Hub's transcript viewer serves any ref with a readable file; without
	 * one it says the transcript is not on this host.
	 */
	sessionFile?: string | null;
	history?: AgentHistorySummary;
}

/** Roster operations a plugin gets for the peers it publishes. */
export interface ScopedExternalAgents {
	/** Announce a peer, or update the row this scope already published under `id`. */
	upsert(input: ExternalAgentInput): void;
	/** Update a published peer's state; false when the id is not this scope's. */
	setStatus(id: string, status: AgentStatus): boolean;
	/** Update a published peer's activity gist; false when the id is not this scope's. */
	setActivity(id: string, activity: string): void;
	/** Drop a published peer's row (it left, or the connection is gone for good). */
	remove(id: string): boolean;
	/** Drop every row this scope published (session teardown; a dead session leaves no ghosts). */
	dispose(): void;
}

/** Bind the roster to one publisher: rows it announced are the rows it may drive. */
export function createScopedExternalAgents(registry: AgentRegistry, ownerId: string): ScopedExternalAgents {
	const published = new Set<string>();
	const owned = (id: string): AgentRef | undefined => {
		if (!published.has(id)) return undefined;
		const ref = registry.get(id);
		// A local agent must never be mistaken for a peer row: if the id was
		// re-registered as a local agent, drop our claim instead of driving it.
		if (!ref || ref.kind !== "external") {
			published.delete(id);
			return undefined;
		}
		return ref;
	};

	return {
		upsert(input) {
			const id = String(input.id ?? "").trim();
			if (!id) return;
			const existing = registry.get(id);
			if (existing && existing.kind !== "external") {
				logger.warn("External agent registration refused: id is owned by a local agent", {
					id,
					ownerId,
					kind: existing.kind,
				});
				return;
			}

			if (existing && !published.has(id)) {
				// Another scope's peer: refreshing it here would let this publisher
				// rewrite (and later remove) a row it never announced.
				logger.warn("External agent registration refused: id belongs to another publisher", { id, ownerId });
				return;
			}
			if (existing) {
				// Same peer coming back or re-announcing: refresh in place, and let
				// the publisher's own activity/status stand (setStatus drops
				// activity when the peer leaves `running`, which is what the Hub's
				// roster wants).
				if (input.displayName) existing.displayName = input.displayName;
				if (input.sessionFile !== undefined) existing.sessionFile = input.sessionFile;
				if (input.history) existing.history = { ...existing.history, ...input.history };
				if (input.status !== undefined) registry.setStatus(id, input.status, existing);
				if (input.activity !== undefined) registry.setActivity(id, input.activity);
				published.add(id);
				return;
			}
			registry.register({
				id,
				displayName: input.displayName || id,
				kind: "external",
				parentId: input.parentId,
				session: null,
				sessionFile: input.sessionFile ?? null,
				status: input.status ?? "running",
				// Only a running peer has current work; activity on an idle row would
				// display as stale work in the roster (`setActivity` refuses it for any
				// non-running status, and registration must match).
				activity: (input.status ?? "running") === "running" ? input.activity : undefined,
				history: input.history,
			});
			published.add(id);
		},
		setStatus(id, status) {
			const ref = owned(id);
			if (!ref) return false;
			return registry.setStatus(id, status, ref);
		},
		setActivity(id, activity) {
			if (!owned(id)) return;
			registry.setActivity(id, activity);
		},
		remove(id) {
			const ref = owned(id);
			if (!ref) return false;
			published.delete(id);
			return registry.unregister(id, ref);
		},
		dispose() {
			// Iterate a copy: `remove` mutates `published`, and `owned` may drop
			// further ids, which would skip unvisited entries mid-iteration.
			// oxlint-disable-next-line unicorn/no-useless-spread -- mutation during iteration
			for (const id of [...published]) this.remove(id);
		},
	};
}
