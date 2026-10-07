# FORK.md — `omp-kouhe3`

本文件描述**这个 fork 相对上游 `can1357/oh-my-pi` 改了什么、为什么改、怎么消费、怎么同步**。
上游文件（`README.md`、`AGENTS.md`、`docs/`）保持上游原样；fork 的差异只记录在这里 + 各包 `CHANGELOG.md` 的 `[Unreleased]` 段。

- 本地检出：`C:/tmp/omp-kouhe3`
- 上游：`origin` = `https://github.com/can1357/oh-my-pi.git`
- 上游镜像（提 PR 用）：`fork` = `https://github.com/kouhe3/oh-my-pi.git`
- 承载 `kouhe3-patch` 的独立仓库：`https://github.com/kouhe3/omp-kouhe3.git`（本地 remote 名 `kouhe3`，默认分支即 `kouhe3-patch`，仅放 fork 提交）
- 基准 tag `v18.8.0` 已随分支推到该仓库：fresh clone 可直接 `git rebase v18.8.0`
- 承载全部 fork 提交的分支：`kouhe3-patch`
- **基准 tag：`v18.8.0`**（`git log -1 v18.8.0` = `4ef97c8826 chore: bump version to 18.8.0`，与分支 merge-base 完全一致；npm `latest` 也是 18.8.0）。同步只跟 tag 走，不跟 `main`——本轮 `v18.8.0` 的 tag commit **恰好等于** `main` HEAD，所以「rebase 到 `main`」和「rebase 到该 tag」这次结果相同；但这是事后校验出来的巧合，不是跟 `main` 的依据，下次仍先认 tag（§5）。

> 状态（2026-10-07，基准 `v18.8.0`）：`kouhe3-patch` = `v18.8.0` + 16 个提交、27 个文件（+839/−62）。净生效的是下表 6 笔 + 6 笔文档；另有 3 笔「外部 peer」实现已被 1 笔 revert 撤销（§2 末尾）。基准只取**已发版**的 tag（§5）。跨基准 rebase 会重写全部 fork commit hash，下表与 §7 的 hash 已按 `v18.8.0` 更新。**本轮换基准踩了三个坑，换基准后照 §5「换基准后必跑的三步」走。**

---

## 1. 定位

这是一个**为了跑起来而非为了合并**的 patch 分支，解决三类上游尚未提供的能力：

1. **扩展的后台任务面**：扩展（如 `omp-pwsh7`）把后台任务注册进宿主，与内置 `bash`/`task`/`eval` 共用 Hub jobs 表、`wait`、取消与完成投递。对应上游未合并 PR [#6909](https://github.com/can1357/oh-my-pi/pull/6909)（by [@incloon](https://github.com/incloon)）+ 该 PR review 指出的三处问题修复。
2. **两个 fork-only 修复**：上游明确不合并或尚未合并的 [#12570](https://github.com/can1357/oh-my-pi/pull/12570)（品牌图标码点）与 [#12486](https://github.com/can1357/oh-my-pi/pull/12486)（PTY dispose 后迟到数据导致进程级崩溃）。
3. **转录端点（transcript-only refs）**：外部渠道扩展（IRC/QQ/Email 桥）注册的 peer 声明 `transcriptOnly` —— 它只有投递面与一份保存的转录，没有可聚焦的实时会话。Hub 里 `⏎` 打开该转录（只读），focus 轮转与 `r`/`x` 跳过它，`history://<peer>` 读转录文件而不是空 stub；`agent://<peer>` 出站投递不受影响。对应上游 issue [#13843](https://github.com/can1357/oh-my-pi/issues/13843)（仍 OPEN，提案即本改动）。

> 对等通话（别人的 agent 与我们在 IRC 上互发消息）**不**靠新的 ref kind：走渠道端点模式（`sub` ref + 投递 stub + `transcriptOnly`），与 QQ 扩展同构。2026-10-05 撤掉的 `AgentKind = "external"`（§2 末尾说明）正是定位相反的那种设计。

**刻意不做**：不重命名/不新增 package 发布面、不动上游 CI 契约、不改上游未涉及的行为。

---

## 2. 变更清单

`git log --oneline v18.6.1..HEAD`（旧 → 新）：

| # | commit | 类型 | 上游归属 | 内容 |
|---|---|---|---|---|
| 1 | `78816cb490` | feat(async) | 携带 #6909 | `AsyncJobType` 从闭集 `"bash"\|"task"\|"eval"` 泛化为受校验的 kind（1–64 位 `[a-z0-9._:-]`）；新增 owner-scoped 注册面 `ctx.asyncJobs.register(kind,label,run,options)`，`ownerId` 钉死、核心字段 allowlist 构造；接进 `ExtensionContext`/`CustomToolContext`/`ExtensionRunner`/`sdk`；TUI `JobSnapshot.type` 放开为 `string`，`async-result` 徽标对 kind/id 做 `replaceTabs` + 截断。修掉 #6909 review 三处：kind 渲染未净化、自定义 job id 未校验、`agentId` 运行时可注入。 |
| 2 | `b876231cc0` | feat(async) | fork-only | `ScopedAsyncJobs.cancel(jobId)`：取消必须走宿主，才会落定为 `cancelled` 并抑制完成投递（扩展自行 abort 会被记成 failed 并把错误当结果投递给模型）。 |
| 3 | `999aa8763a` | fix(async) | fork-only | `cancel` 从 owner 级收紧为 **scope 级**：同 owner 的内置 `bash`/`task`/`eval` 与同会话其他扩展的 job 不可被本 scope 取消。 |
| 4 | `64a3bed73b` | fix(tools) | 携带 #12486 | `Screen` 增加 `#disposed`：`feed`/`resize` 丢弃迟到 PTY chunk（原会写进已释放的 kitty-vt-wasm 抛 `KittyTerminal used after dispose()` 并作为 uncaught exception 杀掉整个会话）；`snapshot`/`png` 改抛可捕获的 `Session stopped`。 |
| 5 | `c59f4fbc23` | fix(tui) | 携带 #12570（上游 CLOSED，标记 intentional） | `icon.omp` 由 `U+F0D57`（Nerd Fonts v3 = `md-axis_z_rotate_clockwise`，旋转箭头）改为 `U+F03FF`（`md-pi`，π）；`GLYPH_CONFIRMATION_CODEPOINT` 同步 `0xf03ff`；`glyph-bundle.json` 重生成后零 diff。 |
| 6 | `9392b1528a` | feat(coding-agent,tui) | 修复 #13843 | `AgentRef`/`RegisterInput` 新增 `transcriptOnly?: boolean`（`register()` 逐字段拷贝，`AgentRecordLike` 镜像）：声明「有转录、无可聚焦实时会话」。Hub `#activateAgent` 对这类行直接 `openChat`，`r`/`x` 拒绝 revive/kill（否则 `release` 会把渠道端点 tombstone）；viewer `#sendable` 为 false；`pickRecentFocusableAgentId` 跳过；`history://<id>` 在取 `ref.session` 前排除它，改读 `sessionFile`，无文件时报 `no transcript` 而非渲染空 stub。 |

> **已撤销**：曾有一组「外部 peer」实现（`AgentKind = "external"` + `ctx.externalAgents` + 各处排除面，提交 `cf30cef1cc`/`6e3c09ba83`/`7efdc997ba`），2026-10-05 整体 revert（提交 `0b0c31e32b` `revert(registry,tui): 撤掉外部 peer`）。原因：那种 peer 只读、**不可投递**（`irc/bus.ts` 直接拒绝）、且被 agent roster / completions / `history://` / collab guest 全部排除 —— 与「IRC 上对等通话」所需的面完全相反，留着只会被误用。要跨机 roster 可见性时可以再评估，届时应给它投递面而不是复用只读形状。

改动文件面（27 个文件，+839/−62；含 `FORK.md` 与两处 `CHANGELOG.md`。**这个数字包含本文件自身**，改 FORK.md 就会漂移，以 `git diff --shortstat v18.8.0...HEAD` 为准）：

- `packages/coding-agent/src/async/job-manager.ts`、`extensibility/{extensions,custom-tools}/{types,runner}.ts`、`sdk.ts` — 后台任务面接线
- `packages/coding-agent/src/registry/agent-registry.ts`、`internal-urls/history-protocol.ts`、`modes/controllers/session-focus-controller.ts` — 转录端点声明与三处消费面（见上表第 6 行）
- `packages/tui/src/overlays/{agent-hub,agent-hub-types,agent-transcript-viewer}.ts`、`chat/transcript-render-helpers.ts`、`tools/wait.ts`、`theme/*`、`glyph-protocol.ts` — Hub 渲染、job 徽标、品牌图标
- `.omp/tools/tui.ts` — 会话停止后的 PTY 竞态
- 测试：`packages/coding-agent/test/{async-job-manager,sdk-agent-surfaces-wiring,agent-hub-activate,agent-hub-advisor-scroll,session-focus-controller}.test.ts`、`test/internal-urls/history-protocol.test.ts`、`packages/tui/test/theme-nerd-symbols.test.ts`

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
| 官方 `omp`（未合并 #6909） | 无 | 回退私有管理器：功能完整，但不出现在 jobs 表/`wait` 集成中，投递由扩展自己做 |

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
# packed vendor\pi-coding-agent-f3a2ce75.tgz (packages/coding-agent@f3a2ce75, v18.6.1)
bun install && bun run typecheck && bun test
```

`vendor/` 不入库，所以 **fresh clone 要先跑这个脚本**（脚本只用 bun/node 内置 + `bun x tsgo`，不需要 node_modules；另一台机器的 fork checkout 用 `--fork` 指过去）。不先跑的话 `bun install` 会因缺 tarball 失败——除非 bun 缓存里恰好有同一份产物，那是运气，不是保障。

脚本行为：

1. 在 `<fork>/packages/coding-agent` 跑 `bun x tsgo -p tsconfig.publish.json` → `dist/types/**/*.d.ts`；
2. 就地重指 manifest（`types` + 118 条 `exports[*].types` → `./dist/types/…`，并把 `dist/types` 加进 `files`）后 `bun pm pack`，产物按 **`packages/coding-agent` 子树 hash** 命名进扩展的 `vendor/`：`pi-coding-agent-<tree8>.tgz`。用子树而不是 HEAD——根目录的 docs 提交不会改名（v18.6.0 基准下 `304a44d89e` 与 `bca1fe582c` 的子树都是 `012e804e`，换到 v18.6.1 后是 `f3a2ce75`）；
3. 自动把扩展 `package.json` 的 devDependency 改成 `file:vendor/pi-coding-agent-<tree8>.tgz`；
4. `finally` 里还原 fork manifest——**fork checkout 跑完保持干净**（`git status` 无输出）。

实测（2026-10-05，fork `kouhe3-patch`，包 v18.6.1，`packages/coding-agent` 子树 `f3a2ce75`，devDep = `file:vendor/pi-coding-agent-f3a2ce75.tgz`）：

```
bun install       → ok（换包后增量安装 22 个 package；首次安装见 2026-10-04 记录的 160 个）
bun run typecheck → 0 error    （含断言 ctx.asyncJobs 类型可用的探针文件）
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
git rev-parse --is-shallow-repository   # 必须是 false，见下方「首次推送」
git fetch origin --tags
# 基准必须已发版：tag 存在 ≠ 发布成功（发布失败/中断的 tag 不算基准）
curl -s https://registry.npmjs.org/@oh-my-pi/pi-coding-agent | grep -q "\"18.8.0\":" && echo released
git rebase v18.8.0            # 换成当前基准 tag；分支 16 个提交逐个重放
bun install
bun run build:native          # 本机 addon 必须与包版本同版（见下方「换基准后必跑的三步」）
bun run check:ts              # oxlint + oxfmt + tsgo（16 个包）
bun run gen:glyphs            # 图标那一笔改过码点；重跑应零 diff
bun scripts/fix-changelogs.ts --check   # rebase 会把 fork 的 changelog hunk 落进已发布段
git diff --check
```

- **基准只取「已发版」的 tag**：上游 `git tag` 只代表 CI 被触发，发布失败/中断的 tag 没有对应版本，取它等于把 `main` 上未验证的问题引进来。采用前确认该版本真的发布过（npm registry 上有该版本，或 `bun install -g @oh-my-pi/pi-coding-agent@<ver>` 能装到）。反例：`v18.6.2` 有 tag，但 npm 上没有 18.6.2（`latest` 仍是 18.6.1），故**不作基准**。
- 当前基准 `v18.8.0` = `4ef97c8826`，与分支 merge-base 一致，且 npm `latest` = 18.8.0（已发版）；换基准时同步改基准 tag 与本节说明。 **`main` HEAD 恰好等于 tag 只算巧合**，不构成跟 `main` 的理由。
- 换基准后 **必须重跑 `bun scripts/pack-fork-dep.ts`**：sha 变了，tarball 与 devDependency 说明符会一起更新。该 sha 是 `packages/coding-agent` 的**子树** hash（`git rev-parse --short=8 HEAD:packages/coding-agent`），本轮落定后为 `b7d323d3`（即 `pi-coding-agent-b7d323d3.tgz`）——**先把本轮变更提交再跑**，未提交的修改不进这个 hash。
- **全局 `omp` 依赖 `~/.bun/install/global/node_modules` 这一层**：`@oh-my-pi/pi-coding-agent` 与 `@oh-my-pi/pi-tui` 都要 link 到 fork（`cd packages/<pkg> && bun link`）；只 link 前者时 fork 的 coding-agent 会配上一份发行版 tui，Hub 等 tui 侧改动不生效。另外 `packages/coding-agent/dist/cli.js` 是 `bun run gen:bundle` 的产物（`bun pm pack` 的 `prepack` 会顺带重建），改完源码要重跑一次。
- **验证 fork 行为别直接跑扩展自带的 e2e**：`Bun.spawn(["omp"])` 会先命中 `<ext>/node_modules/.bin/omp`，也就是扩展自己钉住的发行版（`tencent_qq_bot` 是 18.4.3），于是永远走「宿主不支持」分支。用 `QQBOT_E2E_OMP=<fork>/packages/coding-agent/src/cli.ts` 覆盖宿主，才是 fork 的真实行为。
- **首次推送到空仓库前先解 shallow**：`git rev-parse --is-shallow-repository` 为 `true` 时直接 push 会得到 `remote unpack failed: index-pack failed` 或 `shallow update not allowed`——shallow 边界之外的祖先对象必须由本地提供。本检出曾只差 20 个提交，`git fetch --unshallow origin` 5 秒解决。
- 首次推送整仓约 650 MB / 2 分 45 秒；上游历史里带着若干 `.turbo/cache/*.tar.zst`（52–54 MB），GitHub 会给出 >50 MB 的 GH001 警告（非 LFS，可忽略）。
- rebase 后**核对 `packages/*/CHANGELOG.md`**：按尾部上下文匹配会把「在 `[Unreleased]` 下插入条目」的 hunk 无冲突地插到已发布段之后（本仓已发生三次）。2026-10-05 rebase 到 v18.6.1 时曾逐笔重写 fork 的 changelog hunk、使其锚定文件顶部（紧随 `## [Unreleased]`）；**2026-10-07 rebase 到 v18.8.0 时仍然漂了**，2 处条目落进了已发布的 `## [18.6.2]` 段（`coding-agent`、`tui` 各 2 条），说明跨 933 个提交后上下文锚定靠不住。**结论：不依赖 hunk 落位，rebase 后一律跑 `bun scripts/fix-changelogs.ts` 再 `--check`**（修法与证据见下节第 3 步）。
- `gen:glyphs` 只识别原始 PUA 字符与 `\u{...}`/`\uXXXX` 转义，**不识别十六进制字面量**；码点常量与 `glyph-bundle.json` 必须成对同步，否则 handshake 报 `registered codepoint not served from glossary`。

### 换基准后必跑的三步（2026-10-07 踩过）

上游 18.8.0 给 `@oh-my-pi/pi-natives` 加了 `encodeSixelAsync` / `decodeSixelToPngAsync`（#14529，`07dbd78c0a`），并让 `packages/tui/src/components/image.ts` 直接 import 它们（`9c50001c3e`）。本机两处在 rebase **之前**生成的产物因此同时失效，`omp` 起不来：

**第 1 步：清掉 `node_modules` 里的实体嵌套拷贝（会遮蔽 workspace link）。**

`packages/{tui,coding-agent}/node_modules/@oh-my-pi/pi-natives` 若是**真实目录**（`LinkType` 为空）而非 Junction，就是上次安装留下的实体拷贝（本轮是 18.6.1，装于 10-05）。解析时从调用点向上查找，**先命中包内嵌套目录**，workspace 里已经 18.8.0 的同一个包根本没被加载：

```
SyntaxError: Export named 'encodeSixelAsync' not found in module
  .../packages/tui/node_modules/@oh-my-pi/pi-natives/native/index.js
```

```powershell
# 删掉嵌套实体目录后重跑 install：它们会被重建为指向 packages/natives 的 Junction
Remove-Item -Recurse -Force packages\tui\node_modules\@oh-my-pi\pi-natives, `
                                packages\coding-agent\node_modules\@oh-my-pi\pi-natives
bun install
# 复查：packages/*/node_modules 下不该出现实体（非 Junction）的 @oh-my-pi/* 目录
Get-ChildItem packages -Recurse -Directory -Filter '@oh-my-pi' | ForEach-Object {
  Get-ChildItem $_.FullName -Directory | Where-Object { -not (Get-Item $_.FullName).LinkType }
}
```

**第 2 步：重建本机 native addon（版本戳必须与包版本同版）。**

`packages/natives/native/pi_natives.win32-x64-modern.node` 由 `bun run build:native` 产出（`*.node` 在 `.gitignore` 里，不进版本控制），安装期会把 `packages/natives/package.json#version` 打进 addon 的版本槽（`scripts/stamp-native-version.ts`）。跨基准后戳仍是旧版，新导出取不到：

```
@oh-my-pi/pi-natives export `encodeSixelAsync` is missing:
  ...\pi_natives.win32-x64-modern.node is the @oh-my-pi/pi-natives@18.4.3 addon,
  not @18.8.0 — rebuild it with `bun run build:native`.
```

换基准前这类失效只是「测试噪音」，**换基准后会直接变成启动失败**：import 一个上游新增、本机 addon 没有的导出，在链接期就抛 `SyntaxError`，`omp` 连 TUI 都进不去（§6 的 2026-10-05 实测记录曾把它归入可忽略的环境族）。

> 只查 `typeof` 会被骗：加载器在 addon 过期时把缺失导出回退成**调用即抛**的占位函数（`missingNativeExport`），所以 `typeof encodeSixelAsync === "function"` 并不代表可用，必须真调一次（§6 给了命令）。

**第 3 步：修正 fork changelog 的落位。**

跨基准 rebase 会重放 fork 的 changelog hunk。本轮 2 处条目被无冲突地插进了**已发布的 `## [18.6.2]` 段**（`coding-agent`、`tui` 各 2 条），既违反「已发布段不可改」，又让 `[Unreleased]` 空着：

```bash
bun scripts/fix-changelogs.ts --check   # 报 "N promoted item(s)" 就是要修
bun scripts/fix-changelogs.ts           # 修完再 --check 应为 "already clean"
```

---

## 6. 验证

```bash
# 静态
bun run check:ts

# 后台任务面（含 scoped cancel 归属、投递抑制）
bun test packages/coding-agent/test/async-job-manager.test.ts

# 扩展面接线（真实 createAgentSession → ExtensionRunner → ctx）
bun test packages/coding-agent/test/sdk-agent-surfaces-wiring.test.ts

# TUI 侧
bun test packages/tui/test/theme-nerd-symbols.test.ts

# 转录端点（Hub ⏎ 打开转录、focus 轮转跳过、history:// 读文件）
bun test packages/coding-agent/test/agent-hub-activate.test.ts \
         packages/coding-agent/test/agent-hub-advisor-scroll.test.ts \
         packages/coding-agent/test/session-focus-controller.test.ts \
         packages/coding-agent/test/internal-urls/history-protocol.test.ts

# 图标 bundle 与源码一致性
bun run gen:glyphs && git diff --exit-code packages/tui/src/theme/glyph-bundle.json

# 本机 addon 版本戳与真实可用性（typeof 会被占位函数骗，必须真调一次）
bun -e 'const m = await import("@oh-my-pi/pi-natives"); const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DAwMDAwMDEAAQMDAwAJQAB/8k0sQAAAABJRU5ErkJggg==", "base64"); console.log((await m.encodeSixelAsync(new Uint8Array(png), 4, 4)).slice(0, 2));'

# 冒烟：CLI 起得来（--version / --help / stats / --smoke-test）
bun run ci:test:smoke
```

判定标准：与 stash 出的基线（基准 tag）逐项比对，**未新增失败**即通过（kitty keyboard / OSC 11 / `file://` URL / theme-init / timeout 属环境族，可忽略）。

实测（2026-10-05，rebase 到 v18.6.1 后）：`bun test packages/coding-agent packages/tui` 在本分支为 19386 pass / 55 fail；同一命令在干净上游检出（`C:/tmp/oh-my-pi`，`6d8552d7f9` = v18.6.0+9）为 19343 pass / 58 fail，两边失败集合互有 1–3 个 flaky 差集，其余逐项重合——环境族全覆盖：provider 凭据缺失（`No API key found for ollama`、`no default and no authed model`）、本地 native 产物过期（`vcs.requireGit().commitTree is not a function`，v18.6.0 与 v18.6.1 的 `worktree.ts` 与 `packages/natives/native` 均无差异）、5s 超时、OSC 11 / kitty keyboard、`file://` URL。**fork 相关测试文件零失败。**

实测（2026-10-07，rebase 到 v18.8.0 后）：本轮的失败模式正是上段里被归为可忽略的「本地 native 产物过期」。跨了 933 个上游提交（`v18.6.1` → `v18.8.0`）之后它从测试噪音升级成启动即抛 `SyntaxError`。教训：环境族失败要把「凭据/数据缺失」与「本机产物过期」分开看，**后者在换基准后必须先修，再拿测试结果当基线**（修法与诊断命令见 §5）。

---

## 7. 回退

```bash
# 回到官方 omp（会解除 bun link）
bun install -g @oh-my-pi/pi-coding-agent
# 恢复本 fork 的链接
cd C:/tmp/omp-kouhe3/packages/coding-agent && bun link
```

单个特性回退：

- 后台任务面 → `git revert 78816cb490 b876231cc0 999aa8763a`
- PTY 竞态（#12486）→ `git revert 64a3bed73b`
- 品牌图标（#12570）→ `git revert c59f4fbc23`（注意同步 `glyph-protocol.ts` 并重跑 `gen:glyphs`）
- 转录端点 / transcript-only refs（#13843）→ `git revert 9392b1528a`

---

## 8. 已知风险

- **上游已明确拒绝 #12570**（维护者标记 intentional）。fork 的功能/修复提交里只有这一笔是「上游不要的」，其余是未合并或 fork-only 增量；把 `kouhe3-patch` 当 PR 分支推到上游会夹带它。
- **`catalog:` 协议耦合**：`packages/*/package.json` 的依赖全走 `catalog:`，只能在 monorepo 内解析。任何外部消费方式都必须先打包（§4）。
- **基准是 tag**：只跟**已发版**的 tag，不跟 `main`（本轮 `main` HEAD 恰好 == `v18.8.0` tag，是巧合不是策略）；换基准必须同步重打包（§5）。
- **本机 native addon 是手工产物**：`packages/natives/native/*.node` 不进版本控制、带自己的版本戳，跨基准不重建就会在「上游新增导出」时直接启动失败；缺失导出只以「调用即抛」的占位函数形式出现，静态检查看不出来（§5 第 2 步）。
- **fork-only API 无文档面**：`ctx.asyncJobs` 与 ref 上的 `transcriptOnly` 不在上游 `docs/` 里，本文件是它们的唯一说明。
- **tarball 是 types-only**：§4.1/4.2 的产物只重指了 `types`，不能当运行时安装使用。
