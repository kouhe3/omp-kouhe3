# FORK.md — `omp-kouhe3`

本文件描述**这个 fork 相对上游 `can1357/oh-my-pi` 改了什么、为什么改、怎么消费、怎么同步**。
上游文件（`README.md`、`AGENTS.md`、`docs/`）保持上游原样；fork 的差异只记录在这里 + 各包 `CHANGELOG.md` 的 `[Unreleased]` 段。

- 本地检出：`C:/tmp/omp-kouhe3`
- 上游：`origin` = `https://github.com/can1357/oh-my-pi.git`
- 上游镜像（提 PR 用）：`fork` = `https://github.com/kouhe3/oh-my-pi.git`
- 承载 `kouhe3-patch` 的独立仓库：`https://github.com/kouhe3/omp-kouhe3.git`（push 目标，仅放 fork 提交）
- 承载全部 fork 提交的分支：`kouhe3-patch`
- **基准 tag：`v18.6.0`**（`git log -1 v18.6.0` = `89d2610993 chore: bump version to 18.6.0`，与分支 merge-base 完全一致）。同步只跟 tag 走，不跟 `main`。

> 状态（2026-10-04）：`kouhe3-patch` = `v18.6.0` + 8 个提交、35 个文件（+1171/−85）。相对 `origin/main` 落后 9 个提交——`main` 上带错误，故不作为基准。

---

## 1. 定位

这是一个**为了跑起来而非为了合并**的 patch 分支，解决三类上游尚未提供的能力：

1. **扩展的后台任务面**：扩展（如 `omp-pwsh7`）把后台任务注册进宿主，与内置 `bash`/`task`/`eval` 共用 Hub jobs 表、`wait`、取消与完成投递。对应上游未合并 PR [#6909](https://github.com/can1357/oh-my-pi/pull/6909)（by [@incloon](https://github.com/incloon)）+ 该 PR review 指出的三处问题修复。
2. **外部 peer**：跨机器/跨宿主的 agent 作为只读 roster 条目出现在 Agent Hub，主会话可通过扩展 API 发布。
3. **两个 fork-only 修复**：上游明确不合并或尚未合并的 [#12570](https://github.com/can1357/oh-my-pi/pull/12570)（品牌图标码点）与 [#12486](https://github.com/can1357/oh-my-pi/pull/12486)（PTY dispose 后迟到数据导致进程级崩溃）。

**刻意不做**：不重命名/不新增 package 发布面、不动上游 CI 契约、不改上游未涉及的行为。

---

## 2. 变更清单

`git log --oneline v18.6.0..HEAD`（旧 → 新）：

| # | commit | 类型 | 上游归属 | 内容 |
|---|---|---|---|---|
| 1 | `13d61d4882` | feat(async) | 携带 #6909 | `AsyncJobType` 从闭集 `"bash"\|"task"\|"eval"` 泛化为受校验的 kind（1–64 位 `[a-z0-9._:-]`）；新增 owner-scoped 注册面 `ctx.asyncJobs.register(kind,label,run,options)`，`ownerId` 钉死、核心字段 allowlist 构造；接进 `ExtensionContext`/`CustomToolContext`/`ExtensionRunner`/`sdk`；TUI `JobSnapshot.type` 放开为 `string`，`async-result` 徽标对 kind/id 做 `replaceTabs` + 截断。修掉 #6909 review 三处：kind 渲染未净化、自定义 job id 未校验、`agentId` 运行时可注入。 |
| 2 | `07647abfe2` | feat(async) | fork-only | `ScopedAsyncJobs.cancel(jobId)`：取消必须走宿主，才会落定为 `cancelled` 并抑制完成投递（扩展自行 abort 会被记成 failed 并把错误当结果投递给模型）。 |
| 3 | `16fffa82eb` | fix(async) | fork-only | `cancel` 从 owner 级收紧为 **scope 级**：同 owner 的内置 `bash`/`task`/`eval` 与同会话其他扩展的 job 不可被本 scope 取消。 |
| 4 | `29339d1251` | feat(hub) | fork-only | registry 新增 `AgentKind = "external"`；Hub 中外部 peer 为只读条目（`isRunning` 恒 false，不带 `session`/`sessionFile`）。 |
| 5 | `a74255ced8` | feat(registry) | fork-only | 主会话扩展上下文新增 `ctx.externalAgents`（`upsert`/`setStatus`/`setActivity`/`remove`/`dispose`），发布的每行钉死 `kind=external` + `session=null`，只能驱动自己发布的行。 |
| 6 | `304a44d89e` | fix(registry) | fork-only | 外部 peer 只在 Hub 出现：agent 可见 roster、focus 轮转、collab guest、`history://`、IRC 群发一律排除（新增 `isLocalAgentRef`）；修掉 sdk 里 `hasSession` 未置位导致 `ctx.externalAgents` 生产不可达的错误门；`upsert` 只刷新本 scope 宣告过的 id。 |
| 7 | `00159d5dae` | fix(tools) | 携带 #12486 | `Screen` 增加 `#disposed`：`feed`/`resize` 丢弃迟到 PTY chunk（原会写进已释放的 kitty-vt-wasm 抛 `KittyTerminal used after dispose()` 并作为 uncaught exception 杀掉整个会话）；`snapshot`/`png` 改抛可捕获的 `Session stopped`。 |
| 8 | `22fd555641` | fix(tui) | 携带 #12570（上游 CLOSED，标记 intentional） | `icon.omp` 由 `U+F0D57`（Nerd Fonts v3 = `md-axis_z_rotate_clockwise`，旋转箭头）改为 `U+F03FF`（`md-pi`，π）；`GLYPH_CONFIRMATION_CODEPOINT` 同步 `0xf03ff`；`glyph-bundle.json` 重生成后零 diff。 |

改动文件面（35 个文件，+1171/−85）：

- `packages/coding-agent/src/async/job-manager.ts`、`extensibility/{extensions,custom-tools}/{types,runner}.ts`、`sdk.ts` — 后台任务面接线
- `packages/coding-agent/src/registry/{agent-registry,external-agents}.ts`、`internal-urls/{history-protocol,registry-helpers}.ts`、`irc/bus.ts`、`collab/host.ts`、`modes/{agent-hub-runtime,controllers/session-focus-controller}.ts`、`task/executor.ts` — 外部 peer 的 roster/排除面
- `packages/tui/src/overlays/{agent-hub,agent-hub-types,agent-transcript-viewer}.ts`、`chat/transcript-render-helpers.ts`、`tools/wait.ts`、`theme/*`、`glyph-protocol.ts` — Hub 渲染、job 徽标、品牌图标
- `.omp/tools/tui.ts` — 会话停止后的 PTY 竞态
- 测试：`packages/coding-agent/test/{async-job-manager,extension-context-external-agents,sdk-agent-surfaces-wiring,agent-hub-activate,session-focus-controller}.test.ts`、`test/registry/{external-peer-ref,scoped-external-agents}.test.ts`、`test/internal-urls/history-protocol.test.ts`、`test/collab/host-registry.test.ts`、`packages/tui/test/theme-nerd-symbols.test.ts`

---

## 3. 扩展后台任务契约（`omp-pwsh7` 等消费者）

宿主面（消费端**结构化声明，不 import 类型**，因此对上游仍能编译）：

```ts
interface HostAsyncJobs {
  register(
    kind: string,
    label: string,
    run: (ctx: { jobId: string; signal: AbortSignal;
                 reportProgress(text: string, details?: Record<string, unknown>): Promise<void> }) => Promise<string>,
    options?: { process?: { command: string; cwd: string; pids(): readonly number[] };
                onProgress?: (text: string, details?: Record<string, unknown>) => void | Promise<void> },
  ): string;
  cancel(jobId: string): boolean;
}
```

判定规则：`ctx.asyncJobs` 存在且 `register`、`cancel` **都是函数** → 走宿主运行时；否则回退扩展私有 job 管理器。`cancel` 必须存在才认（缺它时取消会被记成 failed 并把错误当结果投递）。

| 宿主 | `ctx.asyncJobs` | 行为 |
|---|---|---|
| `omp-kouhe3`（本分支） | 有 | 后台任务进 Hub jobs 表（含 pid/进度）、受会话并发上限约束、双向取消、完成由宿主投递 |
| 官方 `omp`（≤ v18.6.0） | 无 | 回退私有管理器：功能完整，但不出现在 jobs 表/`wait` 集成中，投递由扩展自己做 |

---

## 4. 作为依赖使用（扩展的 devDependency）

**结论：只能通过打包产物。** 四种「看似可行」的方式全部实测失败：

| 方式 | 结果 |
|---|---|
| `"pkg-a": "git+file:///…/probe-mono"`（monorepo 根） | ✗ 装出来的 `node_modules/pkg-a` 内容是**仓库根**（`package.json` 是根 manifest，含 `packages/`），不是子包 |
| `"…git#path:packages/pkg-a"` | ✗ `error: no commit matching "path:packages/pkg-a" found for "pkg-a"`（`#` 只吃 commit-ish） |
| `{ "git": "…", "directory": "packages/pkg-a" }` | ✗ `dependencies expects a map of specifiers` |
| `"@oh-my-pi/pi-coding-agent": "file:C:/tmp/omp-kouhe3/packages/coding-agent"` | ✗ 安装期 `@opentelemetry/exporter-metrics-otlp-proto@catalog: failed to resolve`——on-repo manifest 的依赖全是 `catalog:`，只能在 workspace 内解析 |
| 裸 `bun pm pack` 出的 tgz | ✗ 能装（177 包），但消费者 typecheck 报约 40 条 `TS2307`：manifest 的 `types` 指向 `./src/index.ts`，于是 tsc 跟进 `node_modules` 里的源码，撞上包内 `*.md`/`*.sh`/`*.applescript` 资源导入（只有本仓自己的 tsconfig 声明了它们） |

根因两条：`packages/*/package.json` 的依赖写 `catalog:`（外部无法解析），且 `types` 指 `./src/*.ts`（源码不是可消费的类型面）。上游发布流程正是为此在打包前做两步（`scripts/ci-release-publish.ts` 头注释）：**tsgo 发声明到 `dist/types` + 把 `types`/`exports[*].types` 重指 `dist/types/*.d.ts`**。

### 4.1 本地路线（已验证）

扩展仓库 `omp-pwsh7` 里的 `scripts/pack-fork-dep.ts` 把这三步封装成一条命令：

```bash
cd ~/.omp/agent/extensions/pwsh7
bun scripts/pack-fork-dep.ts          # 可加 --fork <path> / --vendor <dir>
# packed vendor\pi-coding-agent-304a44d8.tgz (fork 304a44d8, v18.6.0)
bun install && bun run typecheck && bun test
```

脚本行为：

1. 在 `<fork>/packages/coding-agent` 跑 `bun x tsgo -p tsconfig.publish.json` → `dist/types/**/*.d.ts`；
2. 就地重指 manifest（`types` + 118 条 `exports[*].types` → `./dist/types/…`，并把 `dist/types` 加进 `files`）后 `bun pm pack`，产物按 fork sha 命名放进扩展的 `vendor/`（`.gitignore` 已忽略）；
3. 自动把扩展 `package.json` 的 devDependency 改成 `file:vendor/pi-coding-agent-<sha>.tgz`；
4. `finally` 里还原 fork manifest——**fork checkout 跑完保持干净**（只剩 untracked `FORK.md`）。

实测（2026-10-04，fork `304a44d8`，v18.6.0）：

```
bun install      → 160 packages installed
bun run typecheck → 0 error   （含断言 ctx.asyncJobs / ctx.externalAgents 类型可用的探针文件）
bun test          → 85 pass / 0 fail
```

注意：tarball 只重指了 `types`，`main`/`bin` 仍指 `./src/*`。它是**types-only 的 devDependency**，不要拿它当运行时安装（需要运行时能力的 fork 构建请走 4.3）。

### 4.2 跨机器路线（release asset）

把同一个 tgz 挂到承载 `kouhe3-patch` 的仓库 release 上，devDependency 换成 URL——脚本 4.1 的产物可直接复用：

```json
{
  "devDependencies": {
    "@oh-my-pi/pi-coding-agent": "https://github.com/kouhe3/omp-kouhe3/releases/download/<tag>/pi-coding-agent-<sha>.tgz"
  }
}
```

代价：每次 fork 变更都要重新打包上传（本地路线只需重跑脚本）。

### 4.3 上游官方打包脚本（未实测）

`bun scripts/ci-release-publish.ts --dry-run` 会为全部公开包执行同样的两步 + `bun pm pack`，`--dry-run`（`const isDryRun = process.argv.includes("--dry-run")`）跳过 `npm publish`。脚本头注释明确它**就地改 manifest，本地跑完要 `git restore`**；本轮未执行，仅作替代方案记录。

---

## 5. 与上游同步

基准是 **release tag**，不是 `main`：

```bash
git fetch origin --tags
git rebase v18.6.0            # 换成当前基准 tag；分支 8 个提交逐个重放
bun install
bun run check:ts              # oxlint + oxfmt + tsgo（16 个包）
bun run gen:glyphs            # 第 8 笔改过码点；重跑应零 diff
git diff --check
```

- 当前基准 `v18.6.0` = `89d2610993`，与分支 merge-base 一致；换基准时同步改基准 tag 与本节说明。
- 换基准后 **必须重跑 `bun scripts/pack-fork-dep.ts`**：sha 变了，tarball 与 devDependency 说明符会一起更新。
- rebase 后**必须人工核对 `packages/*/CHANGELOG.md`**：按尾部上下文匹配会把「在 `[Unreleased]` 下插入条目」的 hunk 无冲突地插到已发布段之后（本仓已发生过两次）。可用 `bun scripts/fix-changelogs.ts --check` 程序化校验。
- `gen:glyphs` 只识别原始 PUA 字符与 `\u{...}`/`\uXXXX` 转义，**不识别十六进制字面量**；码点常量与 `glyph-bundle.json` 必须成对同步，否则 handshake 报 `registered codepoint not served from glossary`。

---

## 6. 验证

```bash
# 静态
bun run check:ts

# 后台任务面（含 scoped cancel 归属、投递抑制）
bun test packages/coding-agent/test/async-job-manager.test.ts

# 外部 peer（roster 语义、跨 scope 隔离、真实会话发布/清理）
bun test packages/coding-agent/test/registry/external-peer-ref.test.ts \
         packages/coding-agent/test/registry/scoped-external-agents.test.ts \
         packages/coding-agent/test/extension-context-external-agents.test.ts \
         packages/coding-agent/test/sdk-agent-surfaces-wiring.test.ts

# TUI 侧
bun test packages/tui/test/theme-nerd-symbols.test.ts

# 图标 bundle 与源码一致性
bun run gen:glyphs && git diff --exit-code packages/tui/src/theme/glyph-bundle.json
```

判定标准：与 stash 出的基线（基准 tag）逐项比对，**未新增失败**即通过（kitty keyboard / OSC 11 / `file://` URL / theme-init / timeout 属环境族，可忽略）。

---

## 7. 回退

```bash
# 回到官方 omp（会解除 bun link）
bun install -g @oh-my-pi/pi-coding-agent
# 恢复本 fork 的链接
cd C:/tmp/omp-kouhe3/packages/coding-agent && bun link
```

单个特性回退：

- 后台任务面 / 外部 peer → `git revert 13d61d4882 07647abfe2 16fffa82eb 29339d1251 a74255ced8 304a44d89e`
- PTY 竞态（#12486）→ `git revert 00159d5dae`
- 品牌图标（#12570）→ `git revert 22fd555641`（注意同步 `glyph-protocol.ts` 并重跑 `gen:glyphs`）

---

## 8. 已知风险

- **上游已明确拒绝 #12570**（维护者标记 intentional）。这 8 个提交里只有这一笔是「上游不要的」，其余是未合并或 fork-only 增量；把 `kouhe3-patch` 当 PR 分支推到上游会夹带它。
- **`catalog:` 协议耦合**：`packages/*/package.json` 的依赖全走 `catalog:`，只能在 monorepo 内解析。任何外部消费方式都必须先打包（§4）。
- **基准是 tag**：`main` 目前含错误，不跟 `main`；换基准必须同步重打包（§5）。
- **fork-only API 无文档面**：`ctx.asyncJobs` / `ctx.externalAgents` 不在上游 `docs/` 里，本文件是它们的唯一说明。
- **tarball 是 types-only**：§4.1/4.2 的产物只重指了 `types`，不能当运行时安装使用。
