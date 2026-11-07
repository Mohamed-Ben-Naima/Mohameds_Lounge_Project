# HQ MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local app ("HQ") that runs a 33-agent IT-services company on the founder's Claude Code Pro subscription. It has a code-enforced hierarchy, an approval Gate, per-project budgets, a live task board, a CEO chat, and a pixel-art open-floor office where every movement reflects a real event.

**Architecture:** A Node/TypeScript server owns a SQLite database, the hierarchy rules (`Company`), and an event-driven `Orchestrator` + `RunQueue`. The orchestrator runs each agent task as a fresh headless `claude -p --restricted` process with role-scoped built-in tools, a per-agent workspace, an egress-blocking hook, and a stdio MCP proxy. The MCP proxy is the agent's only way to act on the company, and HQ checks every call against the hierarchy. A Vite browser UI (plain Canvas 2D + DOM panels) consumes REST + WebSocket events.

**Tech Stack:** Node 24, TypeScript (strict, ESM), `node:sqlite`, Fastify 5 (+ `@fastify/websocket`, `@fastify/static`), `@modelcontextprotocol/sdk`, zod 4, tsx, Vitest, Vite. Claude Code CLI 2.1.x (`C:\Users\ASUS\.local\bin\claude.exe`).

**Spec:** `Design_Docs/00_Inception/2026-11-07-agent-company-design.md`

## Global Constraints

- All code lives in `hq/` at the project root. The project root is a git repo. Gitignore `hq/node_modules/`, `hq/data/`, `hq/web/dist/`, `.superpowers/`.
- Node 24, TypeScript `strict: true`, ESM (`"type": "module"`). Database is `node:sqlite` `DatabaseSync` (no native modules).
- The server binds **127.0.0.1 only**, default port **4600**. It never binds 0.0.0.0.
- **One work run at a time** by default (`HQ_MAX_RUNS=1`), plus one separate chat lane for the CEO chat.
- Default model `sonnet` for every agent (`HQ_MODEL`). CEO model overridable via `HQ_CEO_MODEL` (default `sonnet`).
- Rework cap: **2** rework rounds per review. The third rework request escalates instead.
- Currencies: **TND, EUR, USD** only.
- Company name from `HQ_COMPANY_NAME`, default `"HQ"`. UI copy is English. Agents reply in the language the founder used.
- Agents hold **no credentials**: the child process env is allowlisted (Task 6), and nothing outbound is sent by HQ in the MVP.
- Every agent run uses: `-p --output-format stream-json --verbose --restricted --strict-mcp-config --permission-mode dontAsk --permission-prompts none --disable-slash-commands`. Non-chat runs also use `--no-session-persistence`.
- Each run has a timeout of **20 minutes** (`HQ_RUN_TIMEOUT_MS=1200000`). The CLI has no max-turns flag, so the timeout stands in for the spec's "turn limit". This is a deviation from the spec.
- Pixel art is procedural (drawn in code). No external art assets.
- The Pentester has no shell and its prompt forbids active testing. The egress hook blocks scanners for everyone.
- Spreadsheet deliverables are CSV files (they open in Excel). This is a builder's call that keeps agents off code execution.

## Review Focus

1. **HQ restarted mid-run.** Runs and tasks left `running` must go back to `queued` on startup, never stay stuck. Test in Task 8: `recovers orphaned runs on startup`.
2. **An agent run ends without calling `submit_result`** (crash, forgot, timeout). The task must become `failed` with a visible reason, and a failed lead task must flag the project `blocked`. Test in Task 8: `run ending without submit marks task failed`.
3. **An agent submits files outside its own outbox** (`../`, absolute path, another agent's folder). The submission must be refused. Test in Task 4: `collectOutbox rejects paths outside outbox`.
4. **The Pro usage limit is hit mid-sprint.** The queue must pause until the reset time, put the task back in the queue (not fail it), and resume on its own. Test in Task 8: `usage limit pauses queue and requeues task`.
5. **The founder double-clicks Approve, or acts on an already-decided item.** The second action must return 409 and change nothing. Test in Task 10: `deciding an approval twice returns 409`.

---

## File Structure

```
hq/
  package.json, tsconfig.json, vitest.config.ts, README.md
  src/
    types.ts                      shared domain types
    config.ts                     env → Config
    main.ts                       wiring + listen
    org/roster.ts                 the 33 AgentDefs + DEPARTMENTS (single source of truth)
    org/hierarchy.ts              canAssign / directReports / reviewerOf
    db/db.ts                      openDb + schema
    db/repos/{projects,tasks,runs,approvals,budgets,crossTeam,audit,chat,kv}.ts
    domain/errors.ts              PolicyError
    domain/lifecycle.ts           allowed transitions + board column derivation
    domain/company.ts             every permitted action, enforced + audited + emitted
    events/bus.ts                 typed EventBus + CompanyEvent
    workspace/workspaces.ts       per-agent folders, inbox/outbox, deliverables, path safety
    gate/egress-rules.mjs         shell-command egress rules (plain JS: hook runs without tsx)
    gate/egress-hook.mjs          PreToolUse hook entry
    gate/childEnv.ts              env allowlist for claude child processes
    runner/toolProfiles.ts        built-in + MCP tools per role
    runner/args.ts                claude CLI args, MCP config, settings
    runner/prompts.ts             job descriptions + per-purpose task prompts
    runner/stream.ts              stream-json parsing + usage-limit detection
    runner/types.ts               AgentRunner, RunSpec, RunOutcome
    runner/process.ts             ClaudeRunner (spawns claude.exe)
    orchestrator/tokens.ts        per-run token registry
    orchestrator/queue.ts         RunQueue (lanes, priority, pause)
    orchestrator/orchestrator.ts  event → next step rules, executeRun
    mcp/catalog.ts                tool names, descriptions, zod schemas, dispatch
    mcp/server.ts                 stdio MCP proxy (spawned by claude)
    http/app.ts                   buildApp
    http/internalRoutes.ts        /internal/* (token-authenticated tool calls)
    http/apiRoutes.ts             /api/* (founder UI)
    ceo/chat.ts                   ChatService
  scripts/probe.ts                real-Claude integration probe
  scripts/seed-business-model.ts
  seeds/business-model-sprint.md
  test/...                        mirrors src/
  web/
    index.html, vite.config.ts
    src/{main,api,store}.ts, src/styles.css
    src/panels/{board,chat,approvals,inspector,projectDrawer}.ts
    src/office/{layout,sprites,choreography,scene}.ts
    test/{store,layout,choreography}.test.ts
```

---

### Task 1: Scaffold, roster and hierarchy

**Files:**
- Create: `.gitignore`, `hq/package.json`, `hq/tsconfig.json`, `hq/vitest.config.ts`, `hq/src/types.ts`, `hq/src/org/roster.ts`, `hq/src/org/hierarchy.ts`
- Test: `hq/test/org/hierarchy.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type Role = 'ceo'|'lead'|'specialist'`
  - `type DeptId = 'conception'|'software_cloud'|'cybersecurity'|'network_infra'|'ai_automation'|'marketing_content'|'sales'|'finance_projects'`
  - `type ToolProfile = 'ceo'|'lead'|'writer'|'engineer'`
  - `interface AgentDef { id: string; title: string; role: Role; dept: DeptId|null; leadId: string|null; section: string; duties: string[]; notDuties: string[]; toolProfile: ToolProfile }`
  - `interface Department { id: DeptId; name: string; leadId: string; color: string }`
- Produces (`roster.ts`): `ROSTER: readonly AgentDef[]`, `DEPARTMENTS: readonly Department[]`, `getAgent(id: string): AgentDef` (throws `Error("unknown agent <id>")`)
- Produces (`hierarchy.ts`): `directReports(id): AgentDef[]`, `reviewerOf(id): string|null` (specialist → its lead, lead → `'ceo'`, ceo → `null`), `canAssign(fromId, toId): boolean` (ceo → any lead; lead → own 3 specialists; nothing else), `leadOfDept(dept: DeptId): AgentDef`

Roster ids. Leads first. Departments in this order, with colors from the approved mockup:

| dept | name | color | lead | specialists |
|---|---|---|---|---|
| conception | Conception | `#7a4fa3` | chief-architect | solution-architect, ux-ui-designer, spec-writer |
| software_cloud | Software & Cloud | `#2f7d4f` | cto | software-engineer, cloud-devops-engineer, qa-engineer |
| cybersecurity | Cybersecurity | `#aa3333` | ciso | devsecops-cloud-security-engineer, pentester, audit-compliance-analyst |
| network_infra | Network & Infrastructure | `#3a5f8a` | head-of-infrastructure | network-engineer, systems-engineer, monitoring-engineer |
| ai_automation | AI & Automation | `#1f8a8a` | head-of-ai | ai-integration-engineer, automation-engineer, data-engineer |
| marketing_content | Marketing & Content | `#c46a1a` | cmo | trend-scout, content-creator, digital-marketing-specialist |
| sales | Sales | `#b8860b` | cro | prospect-researcher, outreach-writer, proposal-writer |
| finance_projects | Finance & Projects | `#5b6b2f` | cfo | project-budget-analyst, cost-controller, pricing-business-model-analyst |

Plus `ceo` (role `ceo`, dept `null`, leadId `null`, profile `ceo`). Titles and sections come from the design doc §5. Write 3–5 `duties` and 2–3 `notDuties` per agent from those sections. Tool profiles: leads → `lead`. **engineer** = software-engineer, cloud-devops-engineer, qa-engineer, devsecops-cloud-security-engineer, systems-engineer, ai-integration-engineer, automation-engineer, data-engineer. Every other specialist → `writer`.

- [ ] **Step 1: Init repo and package.** `git init` at the project root. Write `.gitignore`. In `hq/` create `package.json` with `"type":"module"`, deps `fastify@^5 @fastify/websocket @fastify/static @modelcontextprotocol/sdk zod@^4 tsx`, devDeps `typescript vitest vite @types/node`. Add scripts `dev: tsx src/main.ts`, `test: vitest run`, `build:web: vite build web`, `probe: tsx scripts/probe.ts`, `seed:bm: tsx scripts/seed-business-model.ts`. `tsconfig.json`: strict, `module`/`moduleResolution` `NodeNext`, `noEmit`, include `src scripts test web`. `vitest.config.ts` includes `test/**/*.test.ts` and `web/test/**/*.test.ts`. Run `npm install`.

- [ ] **Step 2: Write the failing tests** in `hierarchy.test.ts`:
```ts
test('roster shape', () => {
  expect(ROSTER).toHaveLength(33);
  expect(new Set(ROSTER.map(a => a.id)).size).toBe(33);
  expect(DEPARTMENTS).toHaveLength(8);
  for (const d of DEPARTMENTS) {
    expect(getAgent(d.leadId).role).toBe('lead');
    expect(directReports(d.leadId).map(a => a.role)).toEqual(['specialist','specialist','specialist']);
  }
});
test('canAssign follows the chart only', () => {
  expect(canAssign('ceo','cto')).toBe(true);
  expect(canAssign('ceo','pentester')).toBe(false);
  expect(canAssign('ciso','pentester')).toBe(true);
  expect(canAssign('cto','pentester')).toBe(false);
  expect(canAssign('pentester','qa-engineer')).toBe(false);
  expect(canAssign('cto','ciso')).toBe(false);
});
test('reviewerOf', () => {
  expect(reviewerOf('pentester')).toBe('ciso');
  expect(reviewerOf('ciso')).toBe('ceo');
  expect(reviewerOf('ceo')).toBeNull();
});
test('pentester has no shell profile', () => expect(getAgent('pentester').toolProfile).toBe('writer'));
```
- [ ] **Step 3: Run** `npx vitest run test/org` → FAIL (modules missing).
- [ ] **Step 4: Implement** `types.ts`, `roster.ts`, `hierarchy.ts` per Interfaces.
- [ ] **Step 5: Run** `npx vitest run test/org` → PASS.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(hq): scaffold, 33-agent roster and hierarchy rules"`

---

### Task 2: Database and repositories

**Files:**
- Create: `hq/src/db/db.ts`, `hq/src/db/repos/{projects,tasks,runs,approvals,budgets,crossTeam,audit,chat,kv}.ts`; extend `hq/src/types.ts`
- Test: `hq/test/db/repos.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type ProjectStatus = 'idea'|'sharpening'|'conception'|'budgeting'|'awaiting_approval'|'in_progress'|'awaiting_founder'|'done'|'rejected'`
  - `type Phase = 'conception'|'budgeting'|'delivery'|'report'`
  - `type TaskStatus = 'queued'|'running'|'waiting_subtasks'|'in_review'|'rework'|'done'|'failed'`
  - `type RunPurpose = 'work'|'review'|'compile'|'plan_delivery'|'triage'|'recommend'|'chat'`
  - `type RunStatus = 'queued'|'running'|'succeeded'|'failed'|'paused'`
  - `type Currency = 'TND'|'EUR'|'USD'`
  - `Project { id; title; brief; status: ProjectStatus; blocked: boolean; blockedReason: string|null; createdAt; updatedAt }`
  - `Task { id; projectId; parentId: string|null; phase: Phase; assigneeId; assignedById; title; instructions; status: TaskStatus; feedback: string|null; reworkCount: number; resultSummary: string|null; resultFiles: string[]; attachments: string[] /* absolute paths HQ delivers to the assignee's inbox */; failureReason: string|null; crossTeamRequestId: string|null; createdAt; updatedAt }`
  - `Run { id; agentId; taskId: string|null; projectId: string|null; purpose: RunPurpose; status: RunStatus; sessionId: string|null; costUsd: number; error: string|null; payload: Record<string, unknown>; createdAt; startedAt: string|null; endedAt: string|null }`
  - `Approval { id; projectId; taskId; agentId; kind: 'email'|'linkedin'|'post'|'proposal'|'deployment'|'purchase'|'other'; destination; subject: string|null; content; files: string[]; status: 'pending'|'approved'|'rejected'; ceoRecommendation: 'approve'|'edit'|'reject'|null; ceoNote: string|null; founderEdit: string|null; decidedAt: string|null; createdAt }`
  - `ExternalCost { item: string; amount: number; currency: Currency; recurring: 'once'|'monthly'|'yearly'; source?: string }`
  - `Budget { projectId; estimatedRuns: number; estimatedAiUsd: number; externalCosts: ExternalCost[]; clientPrice: {amount: number; currency: Currency}|null; notes: string; setBy: string; updatedAt }`
  - `CrossTeamRequest { id; projectId; fromAgentId; targetDept: DeptId; need; status: 'open'|'accepted'|'declined'; resolution: string|null; createdAt }`
  - `AuditEntry { id: number; at; actorId; action; entity; entityId; detail: Record<string, unknown> }`
  - `ChatMessage { id; role: 'founder'|'ceo'; text; at }`
- Produces (`db.ts`): `type Db = DatabaseSync`, `openDb(path: string): Db` (`':memory:'` allowed; runs the schema idempotently; `PRAGMA foreign_keys=ON`; WAL for files), `newId(prefix: string): string` → `${prefix}_${8 hex}`, `nowIso(): string`
- Produces (each repo, functions taking `db` first): `create(db, input) → Row`, `get(db, id) → Row|null`, `update(db, id, patch: Partial<Row>) → Row` (sets `updatedAt` where present). Plus `projects.list`, `tasks.listByProject(projectId)`, `tasks.listChildren(parentId)`, `runs.listByStatus(status)`, `runs.sumCostByProject(projectId): number`, `approvals.listPending()`, `budgets.upsert/get(projectId)`, `audit.append(db, {actorId, action, entity, entityId, detail}) / audit.list(db, limit)`, `chat.append / chat.list(limit)`, `kv.get(key): string|null / kv.set(key, value|null)`. JSON columns (`resultFiles`, `attachments`, `files`, `externalCosts`, `clientPrice`, `payload`, `detail`) are serialized inside the repo, and booleans are stored as 0/1.

- [ ] **Step 1: Write failing tests:** `project roundtrip and update`, `task resultFiles JSON roundtrip`, `task with unknown project throws` (expect `tasks.create` to throw), `runs.sumCostByProject sums only that project` (0.5 + 0.25 for p1, 1.0 for p2 → 0.75), `approvals.listPending excludes decided`, `kv set/get/clear`, `audit.list returns newest first`.
- [ ] **Step 2: Run** `npx vitest run test/db` → FAIL.
- [ ] **Step 3: Implement** `db.ts` (schema as a TS string constant) and the repos.
- [ ] **Step 4: Run** `npx vitest run test/db` → PASS.
- [ ] **Step 5: Commit** `feat(hq): sqlite schema and repositories`

---

### Task 3: Lifecycle rules

**Files:**
- Create: `hq/src/domain/errors.ts`, `hq/src/domain/lifecycle.ts`
- Test: `hq/test/domain/lifecycle.test.ts`

**Interfaces:**
- Produces (`errors.ts`): `class PolicyError extends Error { constructor(public code: PolicyCode, message: string) }`, `type PolicyCode = 'not_allowed'|'not_your_report'|'not_assignee'|'not_reviewer'|'wrong_status'|'bad_transition'|'already_decided'|'bad_path'|'subtasks_open'|'budget_missing'|'not_found'`
- Produces (`lifecycle.ts`):
  - `assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void` and `assertTaskTransition(from: TaskStatus, to: TaskStatus): void`. Both throw `PolicyError('bad_transition')`.
  - `type BoardColumn = 'idea'|'sharpening'|'conception'|'budgeting'|'awaiting_approval'|'in_progress'|'lead_review'|'ceo_review'|'awaiting_founder'|'done'`
  - `BOARD_COLUMNS: {id: BoardColumn; label: string}[]` with labels in this order: Ideas, Sharpening, Conception, Budgeting, Needs your OK (plan), In progress, Lead review, CEO review, Needs your OK (delivery), Done
  - `boardColumnOf(project: Project, tasks: Task[], roleOf: (agentId) => Role): BoardColumn | 'rejected'`

Project transitions: idea→sharpening|rejected · sharpening→conception|rejected · conception→budgeting · budgeting→awaiting_approval · awaiting_approval→in_progress|sharpening|rejected · in_progress→awaiting_founder · awaiting_founder→done|in_progress.
Task transitions: queued→running · running→in_review|waiting_subtasks|failed|queued|done · waiting_subtasks→running|failed · in_review→done|rework|failed · rework→running|queued. `done` and `failed` are terminal. (`running→queued` is the usage-limit requeue. `running→done` is only for the CEO's report task.)
`boardColumnOf` for `in_progress`: if any delivery/report task is `queued|running|rework|waiting_subtasks` → `in_progress`. Otherwise, if any task whose assignee is a specialist is `in_review` → `lead_review`. Otherwise, if any lead task is `in_review` → `ceo_review`. Otherwise → `in_progress`. Every other status maps to the column with the same name.

- [ ] **Step 1: Write failing tests:** `allowed project transitions pass` (each pair above), `conception→done throws bad_transition`, `done task cannot move`, `boardColumnOf: running delivery task → in_progress`, `only specialist in_review left → lead_review`, `only lead in_review left → ceo_review`, `budgeting maps to budgeting`, `BOARD_COLUMNS has 10 entries in order`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hq): project and task lifecycle rules`

---

### Task 4: Workspaces and deliverables

**Files:**
- Create: `hq/src/workspace/workspaces.ts`
- Test: `hq/test/workspace/workspaces.test.ts` (uses `fs.mkdtempSync(os.tmpdir())`)

**Interfaces:**
- Consumes: `PolicyError`, `getAgent`
- Produces: `class Workspaces { constructor(rootDir: string) }` with:
  - `dirOf(agentId): string` → `<root>/workspaces/<agentId>`
  - `ensure(agentId): void` creates `notes.md` (`# Notes — <title>\n`), `inbox/`, `outbox/`. For `ceo` it also creates `founder-profile.md` (`# How the founder works\n\n(The CEO keeps this up to date. You can edit it.)\n`).
  - `ensureAll(): void`
  - `deliverInbox(agentId, folder: string, files: string[] /* absolute */): string[]` copies into `inbox/<folder>/` and returns workspace-relative POSIX paths (`inbox/<folder>/<name>`)
  - `collectOutbox(agentId, relPaths: string[]): string[] /* absolute */`. Each path must resolve to an existing **file** inside `<agentDir>/outbox/`. Anything absolute, containing `..` segments that escape, missing, or a directory → `PolicyError('bad_path', <path>)`.
  - `storeDeliverables(projectId, taskId, absFiles: string[]): string[]` copies to `<root>/projects/<projectId>/deliverables/<taskId>/` and returns the stored absolute paths
  - `resolveOwnFile(agentId, relPath): string /* absolute */`: the path must be an existing file under the agent's own `inbox/` or `outbox/`, else `PolicyError('bad_path')` (used for `attachFiles`)
  - `isInsideProjects(absPath): boolean`
  - `founderProfilePath(): string`, `notesPath(agentId): string`

- [ ] **Step 1: Write failing tests:** `ensure creates notes inbox outbox`, `ceo gets founder-profile.md`, `collectOutbox rejects paths outside outbox` (each of `'../ceo/notes.md'`, `'C:\\Windows\\win.ini'`, `'outbox/../../ceo/notes.md'`, `'outbox/missing.md'`, `'outbox'` → throws with `code === 'bad_path'`), `collectOutbox accepts outbox/t1/report.md`, `deliverInbox returns inbox/t1/report.md and copies content`, `storeDeliverables copies under projects/<pid>/deliverables/<tid>`, `resolveOwnFile accepts inbox and outbox, rejects notes.md and ../`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `path.resolve` + `path.relative` (reject when the relative path starts with `..` or is absolute). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hq): per-agent workspaces with path-safe outbox collection`

---

### Task 5: Company — every permitted action, enforced

**Files:**
- Create: `hq/src/events/bus.ts`, `hq/src/domain/company.ts`
- Test: `hq/test/domain/company.test.ts`

**Interfaces:**
- Consumes: repos (Task 2), lifecycle + `PolicyError` (Task 3), `Workspaces` (Task 4), hierarchy (Task 1)
- Produces (`bus.ts`): `type CompanyEvent =`
  `{type:'project.updated'; project: Project}` | `{type:'task.created'; task: Task}` | `{type:'task.updated'; task: Task; prev: TaskStatus}` | `{type:'approval.created'|'approval.updated'; approval: Approval}` | `{type:'crossteam.created'; request: CrossTeamRequest}` | `{type:'budget.updated'; budget: Budget}` | `{type:'run.updated'; run: Run}` | `{type:'run.activity'; runId: string; agentId: string; tool: string}` | `{type:'chat.message'; message: ChatMessage}` | `{type:'company.paused'; until: string|null}`.
  `class EventBus { emit(e: CompanyEvent): void; on(fn: (e: CompanyEvent) => void): () => void }`
- Produces (`company.ts`): `interface CallerCtx { agentId: string; runId: string; taskId: string|null; projectId: string|null; purpose: RunPurpose; crossTeamRequestId: string|null }` and `class Company { constructor(db: Db, bus: EventBus, ws: Workspaces) }`. Every mutation calls `audit.append` (actor = caller.agentId, `'founder'` or `'hq'`) and emits the matching event.

Agent actions (`caller: CallerCtx` first; refusals throw `PolicyError`):

| method | rule |
|---|---|
| `getTaskContext(c) → {task, project, inboxFiles: string[]}` | caller has a task |
| `getBoard(c) → {projects: Project[]; pendingApprovals: number}` | ceo only |
| `createProject(c, {title, brief}) → Project` | ceo only. Status `sharpening` |
| `updateBrief(c, {projectId, brief})` | ceo only. Project `idea`/`sharpening` |
| `assignToLead(c, {leadId, title, instructions, attachFiles?: string[]}) → Task` | ceo only. `c.purpose` ∈ `plan_delivery`/`triage`. Target role `lead`. Project `in_progress`. Phase `delivery`, status `queued`. Under `triage` it sets `task.crossTeamRequestId = c.crossTeamRequestId` and marks that request `accepted`. `attachFiles` go through `ws.resolveOwnFile` into `task.attachments` |
| `createSubtask(c, {assigneeId, title, instructions, attachFiles?}) → Task` | caller is the assignee of `c.taskId`. That task is `running`. `canAssign(caller, assignee)`, else `not_your_report`. The subtask inherits phase and project. `attachFiles` (the caller's inbox/outbox paths) go through `ws.resolveOwnFile` into `task.attachments` |
| `submitResult(c, {summary, files: string[]})` | caller is the assignee and the task is `running`. Open (non-terminal) subtasks → `subtasks_open`. A CFO budgeting-phase task with no budget row → `budget_missing`. Files go through `ws.collectOutbox` → `ws.storeDeliverables` and are saved as `resultFiles`. The CEO's `report` task → `done`, and the project → `awaiting_founder`. Any other task → `in_review` |
| `reviewResult(c, {taskId, decision: 'accept'|'rework', feedback})` | caller === `task.assignedById` and the task is `in_review`. accept → `done`. rework → `reworkCount+1`; if it's now >2 → `failed` with `failureReason='escalated: rework cap reached'`, and if the assignee is a lead, the project gets `blocked=true` with that reason. Otherwise → `rework` with `feedback` |
| `requestCrossTeam(c, {targetDept, need}) → CrossTeamRequest` | lead only, and the target isn't its own dept |
| `declineCrossTeam(c, {requestId, reason})` | ceo only. `c.purpose === 'triage'` |
| `requestOutbound(c, {kind, destination, subject?, content, files?}) → Approval` | caller has a task. Status `pending`. Files collected from the outbox like `submitResult` |
| `recommendOutbound(c, {approvalId, recommendation, note})` | ceo only. Approval `pending` |
| `setBudget(c, BudgetInput)` | caller is `cfo`. Project `budgeting` |

Founder/HQ actions (no caller):
`founderAddProject({title, brief, status: 'idea'|'sharpening'}) → Project` · `startDiscussion(projectId)` (idea→sharpening) · `acceptBrief(projectId)` (→conception) · `decidePlan(projectId, decision: 'approve'|'reject'|'revise', feedback?)` (approve→in_progress, revise→sharpening with feedback appended to brief, reject→rejected) · `decideApproval(approvalId, decision: 'approve'|'reject', editedContent?)` (non-pending → `already_decided`) · `decideReport(projectId, decision: 'accept'|'send_back', feedback?)` (accept→done, send_back→in_progress) · `unblock(projectId)` · `hqCreatePhaseTask({projectId, phase, assigneeId, title, instructions, attachAbs: string[], assignedById: 'ceo'}) → Task` (stores `attachAbs` as `task.attachments`) · `hqSetTaskStatus(taskId, to, patch?)` (transition-checked) · `hqBlockProject(projectId, reason)`.

- [ ] **Step 1: Write failing tests** (in-memory db + tmp workspaces; helper `ctx(agentId, taskId)`):
  - `specialist cannot create subtasks` → `not_allowed`
  - `cto cannot assign pentester` → `not_your_report`
  - `submitResult by non-assignee` → `not_assignee`
  - `submitResult with open subtasks` → `subtasks_open`
  - `cfo budgeting submit without budget` → `budget_missing`
  - `review by wrong agent` → `not_reviewer`
  - `third rework escalates and blocks project for lead task` (status `failed`, `project.blocked === true`)
  - `setBudget by cto refused`
  - `createProject by cro refused`
  - `requestOutbound creates pending approval and emits approval.created`
  - `decideApproval twice` → `already_decided`
  - `ceo report submit moves project to awaiting_founder`
  - `every successful mutation appends one audit row` (count before/after `createSubtask` differs by 1)
- [ ] **Step 2: Run** `npx vitest run test/domain/company.test.ts` → FAIL.
- [ ] **Step 3: Implement** `bus.ts` and `company.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hq): Company service enforcing hierarchy, reviews, gate requests, budgets`

---

### Task 6: Gate — egress rules, hook, child env

**Files:**
- Create: `hq/src/gate/egress-rules.mjs`, `hq/src/gate/egress-hook.mjs`, `hq/src/gate/childEnv.ts`
- Test: `hq/test/gate/egress.test.ts`, `hq/test/gate/childEnv.test.ts`

**Interfaces:**
- Produces: `checkCommand(command: string): {allow: true} | {allow: false; reason: string}` (JSDoc-typed `.mjs`). `egress-hook.mjs` reads the PreToolUse JSON from stdin. For `tool_name` `Bash` or `PowerShell`, it runs `checkCommand(tool_input.command)`. On deny it prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}` and exits 0. Otherwise it prints nothing and exits 0. Malformed input → deny (fail closed).
- Produces: `buildChildEnv(parent: NodeJS.ProcessEnv): Record<string,string>`. Allowlist (case-insensitive key match): `PATH PATHEXT SYSTEMROOT WINDIR COMSPEC USERPROFILE HOME HOMEDRIVE HOMEPATH APPDATA LOCALAPPDATA TEMP TMP LANG`. Everything else is dropped, including `ANTHROPIC_API_KEY`, so runs always use the subscription login.

Deny rules (case-insensitive, word-boundary): any `http://` or `https://` in the command (reason: "use WebFetch to read web pages; nothing leaves this machine from a shell"); `curl wget Invoke-WebRequest iwr Invoke-RestMethod irm Start-BitsTransfer ssh scp sftp ftp telnet nc ncat netcat nmap masscan sqlmap hydra nikto Send-MailMessage sendmail`; `git push`, `git remote add`, `npm publish`, `pnpm publish`, `yarn publish`, `docker push`, and commands starting with `gh `, `aws `, `az `, `gcloud `, `kubectl `, `terraform apply`. `npm install` is allowed (downloads only).

- [ ] **Step 1: Write failing tests:** deny `curl https://x`, `Invoke-WebRequest x` (mixed case), `git push origin main`, `echo https://evil.example`, `nmap 10.0.0.1`. Allow `npm test`, `git commit -m "x"`, `ls -la`, `npm install zod`. `hook denies curl via stdin` (spawn `node egress-hook.mjs`, write `{"tool_name":"Bash","tool_input":{"command":"curl x"}}`, stdout parses to `permissionDecision === 'deny'`). `hook is silent for ls`. `hook denies malformed input`. `childEnv drops secrets` (input has `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `PATH`, `USERPROFILE` → only `PATH`, `USERPROFILE` remain).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hq): gate egress hook and credential-free child env`

---

### Task 7: Runner building blocks — tools, args, prompts, stream parsing

**Files:**
- Create: `hq/src/runner/types.ts`, `toolProfiles.ts`, `args.ts`, `prompts.ts`, `stream.ts`
- Test: `hq/test/runner/{args,prompts,stream}.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `RunSpec { runId: string; agent: AgentDef; purpose: RunPurpose; prompt: string; cwd: string; model: string; token: string; session: {id: string; resume: boolean} | null }`
  - `StreamEvent = {kind:'init'; sessionId: string; tools: string[]; mcpServers: {name: string; status: string}[]; model: string} | {kind:'tool_use'; tool: string} | {kind:'text'; text: string} | {kind:'result'; isError: boolean; costUsd: number; text: string; sessionId: string}`
  - `RunOutcome { ok: boolean; costUsd: number; sessionId: string|null; finalText: string; usageLimit: {resetAt: Date|null} | null; error: string|null }`
  - `interface AgentRunner { run(spec: RunSpec, onEvent: (e: StreamEvent) => void): Promise<RunOutcome> }`
- Produces (`toolProfiles.ts`): `builtinToolsFor(agent): string[]`. writer/lead/ceo = `Read,Write,Edit,Glob,Grep,WebSearch,WebFetch`. engineer = that + `Bash`. `mcpToolsFor(agent): string[]`. specialist = `get_task, submit_result, request_outbound`. lead = specialist + `create_subtask, review_result, request_cross_team`, plus `set_budget` for `cfo`. ceo = `get_task, get_board, create_project, update_brief, assign_to_lead, review_result, decline_cross_team, recommend_outbound, submit_result`.
- Produces (`args.ts`): `RunFiles { systemPromptPath; mcpConfigPath; settingsPath }`.
  - `buildClaudeArgs(spec: RunSpec, files: RunFiles): string[]`: the Global Constraints flags, plus `--mcp-config <mcpConfigPath> --settings <settingsPath> --tools <builtins,comma> --allowedTools <builtins + mcp__hq__<tool>, comma> --append-system-prompt-file <systemPromptPath> --model <model>`. Then the session part: `session.resume` → `--resume <id>`, a session without resume → `--session-id <id>`, `null` → `--no-session-persistence`. The prompt goes on **stdin**, not in args.
  - `buildMcpConfig(hqUrl, token, mcpEntryAbs)` → `{mcpServers:{hq:{command: process.execPath, args:['--import','tsx', mcpEntryAbs], env:{HQ_URL: hqUrl, HQ_RUN_TOKEN: token}}}}`
  - `buildSettings(hookScriptAbs)` → `{hooks:{PreToolUse:[{matcher:'Bash|PowerShell', hooks:[{type:'command', command:`"${process.execPath}" "${hookScriptAbs}"`}]}]}}`
- Produces (`prompts.ts`): `jobDescription(agent, companyName): string` and `taskPrompt(purpose: RunPurpose, ctx: PromptCtx): string`, where `PromptCtx { task?: Task; project?: Project; inboxFiles: string[]; reviewOf?: {task: Task; submitterTitle: string; files: string[]}; subtasks?: Task[]; approval?: Approval; crossTeam?: CrossTeamRequest; founderMessage?: string; boardSummary?: string }`.

`jobDescription` sections: Identity (title, department, section, "You report to <reviewer title>"; leads also list their 3 reports by title) · Your job (duties) · Not your job (notDuties + "anything that belongs to another team") · Rules (exact copy below) · Workspace ("Read notes.md at the start of every task and append short lessons at the end. Your inputs are in inbox/ (read-only). Write every output file in outbox/<taskId>/.") · plus the role extras below.

Rules copy (verbatim):
```
1. You take work only from {reviewerTitle}. You never contact other agents; the hq tools are your only way to act on the company.
2. Do only your own section's work. If a task needs another team, say so in your result{lead: " or use request_cross_team"}.
3. Nothing leaves this machine except through request_outbound, which the founder approves. You have no accounts or credentials for external services; never ask for them.
4. You may search and read the web for research. Cite every external fact with its URL and the date you read it.
5. When you are done, call submit_result exactly once with a short summary and the files you produced.
6. Reply in the language the founder used.
```
Extras: **pentester**: "Active testing is disabled. Produce plans, methodologies and reports only. Never scan, probe or attack any system." **leads**: "Split your task into subtasks for your specialists with create_subtask, one clear job each, and do it yourself only if it is tiny. Review honestly; when you ask for rework, give concrete feedback." **ceo**: "You talk to the founder and delegate only to department leads. You never do department work yourself. Keep founder-profile.md up to date with how the founder works."
`taskPrompt` per purpose. Each names the single tool that finishes it: work → `submit_result`; review → `review_result`; compile (the lead's subtasks are finished; their summaries and files are listed) → `submit_result`; plan_delivery → `assign_to_lead` once per team needed; triage → `assign_to_lead` or `decline_cross_team`; recommend → `recommend_outbound`; chat → reply to the founder in plain text, using `create_project`/`update_brief` when the founder brings an idea or a cahier des charges, and tell the founder to click **Accept brief** on the card when the brief is final. Rework prompts include `task.feedback` under "Your lead asked for changes:".

- Produces (`stream.ts`): `parseStreamLine(line: string): StreamEvent[]`. Mapping: `type:'system',subtype:'init'` → init; `type:'assistant'` content blocks → one `tool_use` per tool block and one `text` per text block; `type:'result'` → result (`total_cost_usd`, `is_error`, `result`, `session_id`). Invalid JSON → `[]`. Also `detectUsageLimit(r: {isError: boolean; text: string}): {resetAt: Date|null} | null`. It matches `/usage limit|limit reached/i`; `resetAt` comes from a trailing `|<epoch seconds>`, else `null`.

- [ ] **Step 1: Write failing tests:**
  - args: `every run is restricted and strict` (contains `--restricted`, `--strict-mcp-config`, `--permission-mode`,`dontAsk`, `--permission-prompts`,`none`). `pentester has no Bash` (value after `--tools` lacks `Bash`). `software-engineer has Bash`. `cto may create subtasks, pentester may not` (in `--allowedTools`: `mcp__hq__create_subtask`). `cfo gets set_budget`. `first chat run uses --session-id, later --resume`. `work run has --no-session-persistence`. `prompt is not in args`.
  - prompts: `pentester description forbids active testing`. `cto description names its three reports`. `every description mentions request_outbound` (loop the ROSTER). `review prompt names the task id and review_result`. `rework prompt includes feedback`.
  - stream: `parses init` (fixture `{"type":"system","subtype":"init","session_id":"s1","tools":["Read","mcp__hq__submit_result"],"mcp_servers":[{"name":"hq","status":"connected"}],"model":"claude-sonnet-5-5"}`). `parses tool_use` (assistant fixture with `{"type":"tool_use","name":"Write"}`). `parses result cost` (`total_cost_usd: 0.0123`). `usage limit with epoch` (`"Claude AI usage limit reached|1794100000"` → `resetAt.getTime() === 1794100000000`). `usage limit without epoch` (`"5-hour limit reached ∙ resets 7pm"` → `{resetAt: null}`). `normal error is not usage limit`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hq): runner args, job descriptions, task prompts, stream parsing`

---

### Task 8: Run queue, orchestrator, Claude process runner

**Files:**
- Create: `hq/src/orchestrator/tokens.ts`, `queue.ts`, `orchestrator.ts`, `hq/src/runner/process.ts`, `hq/test/support/scriptedRunner.ts`
- Test: `hq/test/orchestrator/orchestrator.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces (`tokens.ts`): `class TokenRegistry { mint(ctx: CallerCtx): string /* 32 random bytes hex */; resolve(token): CallerCtx|null; revoke(token): void }`
- Produces (`queue.ts`): `RunRequest { agentId; purpose: RunPurpose; taskId?: string; projectId?: string; payload?: Record<string, unknown> }`. `class RunQueue { constructor(db: Db, bus: EventBus, opts: {maxWork: number; now: () => Date}) ; enqueue(r: RunRequest): Run; nextStartable(): Run[] ; pause(until: Date): void ; resume(): void ; isPaused(): boolean ; recoverOrphans(): void }`. Lanes: `chat` (capacity 1) and everything else (capacity `maxWork`). Priority: `chat` > `review|recommend|triage` > `compile|plan_delivery` > `work`, then FIFO. Paused (`kv paused_until` > now) → nothing startable. `recoverOrphans()` sets runs `running→queued` and tasks `running→queued`.
- Produces (`orchestrator.ts`): `class Orchestrator { constructor(deps: {db; bus; company; queue; ws; tokens; runner: AgentRunner; config: Config; now: () => Date}); start(): void; pump(): void; idle(): Promise<void> }`. `idle()` resolves when nothing is running and nothing is startable (tests await it).
- Produces (`process.ts`): `class ClaudeRunner implements AgentRunner { constructor(opts: {claudePath; hqUrl; mcpEntry; hookScript; runsDir; timeoutMs; companyName}) }`. It writes `RunFiles` into `runsDir/<runId>/`, spawns `claudePath` with `buildClaudeArgs`, `cwd: spec.cwd`, `env: buildChildEnv(process.env)`, `shell: false`, writes `spec.prompt` to stdin, splits stdout by line → `parseStreamLine` → `onEvent`, and kills the process on timeout (`error: 'timeout'`). The outcome comes from the `result` event, plus `detectUsageLimit`.

Orchestrator rules (event → action). The full mapping:
- `project.updated` to `conception` → `hqCreatePhaseTask(conception, chief-architect, title "Design: <project>", instructions = brief)`.
- CEO accepts the last open `conception` task → project `budgeting` → `hqCreatePhaseTask(budgeting, cfo, attachAbs = all conception deliverables)`.
- CEO accepts the last `budgeting` task → project `awaiting_approval`.
- `project.updated` to `in_progress` (from approval or send_back) → enqueue `plan_delivery` for ceo. If that run ends with no new delivery task → `hqBlockProject("CEO assigned no work")`.
- CEO accepts the last open `delivery` task → `hqCreatePhaseTask(report, ceo, attachAbs = all project deliverables)`.
- `task.created` / `task.updated` to `queued` or `rework` → enqueue `work` (`compile` when the task has children all terminal).
- `task.updated` to `in_review` → enqueue `review` for `task.assignedById` (the reviewer's inbox gets the files under `review-<taskId>/`).
- `task.updated` to `done`/`failed` for a subtask → if all siblings are terminal → parent `waiting_subtasks→running` + enqueue `compile` for the parent assignee.
- `approval.created` → enqueue `recommend` for ceo. `crossteam.created` → enqueue `triage` for ceo (payload `crossTeamRequestId`).
- `executeRun(run)`: mint a token (ctx from run; `crossTeamRequestId` from `run.payload` for triage) → `ws.ensure` → deliver inbox files (`task.attachments` → `inbox/<taskId>/`, reviewed task's `resultFiles` → `inbox/review-<taskId>/`, children's `resultFiles` for compile) → `taskPrompt` → `runner.run` (forward `tool_use` as `run.activity`) → record `costUsd`/`sessionId` (the chat session id is saved to kv `ceo_session_id`) → revoke the token. Then handle the outcome:
  - `usageLimit` → run `paused`, task `running→queued`, `queue.pause(resetAt ?? now+30min)`, emit `company.paused`, set a timer to `resume()` + `pump()`.
  - `!ok` → run `failed`, task `failed` with `failureReason=error`, and a lead/CEO task blocks the project.
  - `ok`, purpose `work`/`compile`, task still `running`: a lead with open children → `waiting_subtasks`. Otherwise → `failed`, `failureReason='ended without submit_result'`, and a lead task blocks the project.
  - `ok`, purpose `review`, task still `in_review` → re-enqueue the review once (`payload.retry=1`). A second miss → block the project.
  - purpose `chat` → `chat.append(ceo, outcome.finalText)`.
- `ScriptedRunner` (test support): `new ScriptedRunner(company, scripts: Record<string /* agentId:purpose */, (c: CallerCtx, api: Company) => void | RunOutcome>)`. For each run it resolves the token ctx through the shared `TokenRegistry`, calls the script, and returns `{ok: true, costUsd: 0.01, ...}` unless the script returns an outcome. Unscripted → `ok` with no action.

- [ ] **Step 1: Write failing tests:**
  - `full chain to awaiting_approval`: founderAddProject(sharpening) → acceptBrief → scripts: chief-architect:work creates a subtask for solution-architect; solution-architect:work submits `outbox/<tid>/arch.md`; chief-architect:review accepts; chief-architect:compile submits; ceo:review accepts; cfo:work setBudget + submit; ceo:review accepts → `await orch.idle()` → project `awaiting_approval`, budget present, ≥1 deliverable stored.
  - `approval to done`: from awaiting_approval → decidePlan approve → ceo:plan_delivery assigns cfo and cmo → each lead's work submits directly → ceo reviews accept → ceo:work (report) submits → project `awaiting_founder` → decideReport accept → `done`. `runs.sumCostByProject` equals 0.01 × number of runs for the project.
  - `run ending without submit marks task failed`: the specialist script does nothing → task `failed`, `failureReason === 'ended without submit_result'`.
  - `failed lead task blocks project`.
  - `usage limit pauses queue and requeues task`: the script returns `{ok:false, usageLimit:{resetAt: now+1h}}` the first time → task `queued`, `queue.isPaused()`, nothing started. Advance the fake clock past resetAt and call `pump()` → the task completes on retry.
  - `recovers orphaned runs on startup`: insert run+task `running` → `recoverOrphans()` → both `queued`.
  - `max one work run at a time`: a runner whose promises are held → two queued work runs → only one `running`.
  - `chat lane runs alongside a work run`.
  - `cross-team request goes to CEO triage`: cto:work calls requestCrossTeam(cybersecurity) → a `triage` run for ceo is enqueued with payload.crossTeamRequestId.
- [ ] **Step 2: Run** `npx vitest run test/orchestrator` → FAIL.
- [ ] **Step 3: Implement** tokens, queue, orchestrator, ClaudeRunner (ClaudeRunner gets no unit test; Task 11 probes it for real).
- [ ] **Step 4: Run** → PASS. Also run the full suite: `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(hq): run queue, orchestrator rules, claude process runner`

---

### Task 9: MCP proxy and internal tool endpoint

**Files:**
- Create: `hq/src/mcp/catalog.ts`, `hq/src/mcp/server.ts`, `hq/src/http/internalRoutes.ts`
- Test: `hq/test/mcp/internal.test.ts`, `hq/test/mcp/proxy.test.ts`

**Interfaces:**
- Consumes: `Company`, `TokenRegistry`, `mcpToolsFor`
- Produces (`catalog.ts`): `TOOL_CATALOG: Record<string, {description: string; schema: z.ZodObject<any>}>` (one entry per tool name in Task 7, with schemas matching the Company method inputs; `kind` and currency are enums). `dispatch(company: Company, caller: CallerCtx, name: string, args: unknown): unknown` parses with zod and calls the method.
- Produces (`internalRoutes.ts`): a Fastify plugin `internalRoutes(deps: {company; tokens})`. It authenticates `Authorization: Bearer <token>` (missing/unknown → 401). `GET /internal/tools` → `[{name, description, inputSchema: z.toJSONSchema(schema)}]` filtered by `mcpToolsFor(caller agent)`. `POST /internal/tool/:name` with body `{args}` → a tool not in the caller's list gives 403 `{code:'not_allowed'}`; `ZodError` → 400; `PolicyError` → 403 `{code, message}`; success → 200 `{result}`.
- Produces (`server.ts`): a stdio MCP server (low-level `Server` from `@modelcontextprotocol/sdk/server/index.js` with `ListToolsRequestSchema`/`CallToolRequestSchema`). It reads `HQ_URL` and `HQ_RUN_TOKEN` from env. List → GET `/internal/tools`. Call → POST `/internal/tool/:name` → `{content:[{type:'text', text: JSON.stringify(body)}], isError: status !== 200}`.

- [ ] **Step 1: Write failing tests:** `no token → 401`. `specialist sees exactly get_task, submit_result, request_outbound`. `cfo sees set_budget`. `specialist calling create_subtask → 403 not_allowed`. `bad args → 400`. `revoked token → 401`. `policy refusal surfaces code` (cto create_subtask for pentester → 403 `not_your_report`). Proxy test: `mcp proxy lists caller tools and forwards calls` (start the Fastify app on port 0, spawn `node --import tsx src/mcp/server.ts` with env via the SDK `StdioClientTransport`, `client.listTools()` names match, `callTool get_task` returns the task id).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(hq): token-authenticated MCP proxy for agent tool calls`

---

### Task 10: HTTP API, WebSocket, CEO chat, wiring

**Files:**
- Create: `hq/src/config.ts`, `hq/src/ceo/chat.ts`, `hq/src/http/apiRoutes.ts`, `hq/src/http/app.ts`, `hq/src/main.ts`
- Test: `hq/test/http/api.test.ts`

**Interfaces:**
- Produces (`config.ts`): `Config { host: '127.0.0.1'; port: number; dataDir: string; maxWorkRuns: number; model: string; ceoModel: string; companyName: string; claudePath: string; runTimeoutMs: number }` and `loadConfig(env): Config`. Defaults: port 4600, `dataDir = hq/data`, maxWorkRuns 1, models `sonnet`, companyName `HQ`, claudePath `claude`, runTimeoutMs 1200000. `host` is not configurable.
- Produces (`chat.ts`): `class ChatService { constructor(db, bus, queue); send(text: string): ChatMessage }` appends the founder message, emits `chat.message`, and enqueues `{agentId:'ceo', purpose:'chat', payload:{text}}`.
- Produces (`app.ts`): `buildApp(deps: {config; db; bus; company; queue; orchestrator; ws; tokens; chat}): FastifyInstance`. It registers `internalRoutes`, `apiRoutes`, `/ws` (broadcasts every bus event as JSON), and static `web/dist` at `/`.
- Produces (`apiRoutes.ts`), JSON:
  - `GET /api/state` → `{companyName, departments, agents: (AgentDef & {state: 'idle'|'working'|'waiting'|'blocked'; currentTaskId: string|null})[], projects: (Project & {column})[], tasks, pendingApprovals: Approval[], pausedUntil: string|null}`
  - `GET /api/projects/:id` → `{project, tasks, deliverables: {taskId; files: string[]}[], budget, actualAiUsd}`
  - `GET /api/files?path=` → streams a file only if `ws.isInsideProjects(path)`, else 403
  - `POST /api/ideas {title, brief}`, `POST /api/projects/:id/discuss` (startDiscussion + `chat.send("Let's sharpen \"<title>\" together.")`), `POST /api/projects/:id/accept-brief`, `POST /api/projects/:id/plan {decision, feedback?}`, `POST /api/projects/:id/report {decision, feedback?}`, `POST /api/projects/:id/unblock`, `POST /api/approvals/:id {decision, editedContent?}`
  - `GET /api/chat`, `POST /api/chat {text}`; `GET|PUT /api/founder-profile {text}`; `POST /api/company/pause`, `POST /api/company/resume`; `GET /api/agents/:id` → `{agent, notes, recentRuns, recentAudit}`; `GET /api/audit?limit=`
  - `PolicyError` mapping: `already_decided|bad_transition|wrong_status` → 409, `not_found` → 404, others → 403.
- `main.ts`: loadConfig → openDb → Workspaces.ensureAll → construct everything → `queue.recoverOrphans()` → `orchestrator.start()` → `app.listen({host: '127.0.0.1', port})` → log the URL.

- [ ] **Step 1: Write failing tests** (`app.inject`, ScriptedRunner): `accept-brief moves sharpening to conception`, `accept-brief twice returns 409`, `deciding an approval twice returns 409` (and the approval's `founderEdit` is unchanged by the second call), `chat POST enqueues a chat run for ceo`, `founder profile roundtrip`, `files outside projects → 403`, `state lists 33 agents and 10-column projects`, `config host is always 127.0.0.1` (even with `HQ_HOST=0.0.0.0` in env).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, then `npm test` → all PASS.
- [ ] **Step 5: Commit** `feat(hq): founder API, websocket events, CEO chat, app wiring`

---

### Task 11: Real-Claude probe

**Files:**
- Create: `hq/scripts/probe.ts`
- Modify (only if the probe shows a mismatch): `hq/src/runner/args.ts` + its test

**Interfaces:**
- Consumes: `main.ts` building blocks with a temp `dataDir`, `ClaudeRunner`.

The probe starts HQ in-process on a random port with a temp data dir and runs **two real runs** (small Pro usage):
1. `trend-scout`, work: "Write outbox/<taskId>/hello.md containing the word hello, then call submit_result with that file."
2. `software-engineer`, work: "Run the shell command `curl https://example.com`. Then write outbox/<taskId>/result.md saying whether it was blocked, and submit it."

It prints a PASS/FAIL table for these checks:
- (a) the init event's `tools` ⊆ the profile's built-ins ∪ `mcp__hq__*`
- (b) MCP server `hq` status is `connected`
- (c) no skills/slash commands or plugin tools appear
- (d) run 1's task reaches `in_review` with `hello.md` stored
- (e) run 2's stream shows the hook denial and the task reaches `in_review`
- (f) `costUsd` is recorded
- (g) the child env had no `ANTHROPIC_API_KEY`

- [ ] **Step 1: Write** `probe.ts` as described.
- [ ] **Step 2: Run** `npm run probe` (requires a logged-in `claude`). Expected: all checks PASS.
- [ ] **Step 3: If a check fails, fix it at the source.** If `--append-system-prompt-file` is rejected → pass `--append-system-prompt <text>` instead and update the args test. If user CLAUDE.md, memory or plugins show up in init → add `--setting-sources ""` (or the flag the init output points to) and add an args test asserting it. If `--permission-prompts none` blocks the hook → keep `dontAsk` and drop that flag. Re-run until all PASS.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `test(hq): real claude probe and flag fixes`

---

### Task 12: Web UI shell and panels

**Files:**
- Create: `hq/web/index.html`, `hq/web/vite.config.ts`, `hq/web/src/{main,api,store}.ts`, `hq/web/src/styles.css`, `hq/web/src/panels/{board,chat,approvals,inspector,projectDrawer}.ts`
- Test: `hq/web/test/store.test.ts`

**Interfaces:**
- Consumes: `/api/*`, `/ws`, `CompanyEvent`, and `BOARD_COLUMNS` imported directly from `../../src/domain/lifecycle` (Vite resolves it; never copy the column list).
- Produces (`store.ts`): `type UiState = Awaited<ReturnType<api.getState>>`, `reduce(state: UiState, e: CompanyEvent): UiState` (pure), `groupByColumn(projects): Record<BoardColumn, Project[]>` (all 10 keys, in order).
- Layout: a top bar with the company name, a **"Company on break until HH:MM"** banner when paused, a Pause/Resume button, and an Inbox badge (pending approvals + projects in `awaiting_approval`/`awaiting_founder`/`blocked`). Main tabs are **Office** (canvas, Task 13) and **Board** (10 columns full width; cards show title, blocked badge and AI cost). A right sidebar always shows **CEO chat** (message list + input, with a "CEO is thinking…" line while a chat run is running) and **Inbox** (approvals with the CEO recommendation, editable content, Approve/Reject, plus "Copy" and file download after approval). The project drawer opens from a card: brief, task tree with assignee titles/status/failure reasons, deliverable download links, budget estimate vs actual, and the founder buttons that fit the status (Discuss with CEO · Accept brief · Approve/Revise/Reject plan · Accept/Send back report · Unblock). The agent inspector (`openInspector(agentId)`) shows role, lead, current task, notes.md and recent actions. There's a Founder profile editor in the sidebar. Styles use CSS tokens on `:root`, a dark office theme, and a readable 14px base.
- `vite.config.ts`: `root: 'web'`, `build.outDir: 'dist'`, dev proxy `/api` and `/ws` → `http://127.0.0.1:4600`.

- [ ] **Step 1: Write failing tests:** `reduce applies task.updated`, `reduce adds approval and counts pending`, `company.paused sets pausedUntil`, `groupByColumn returns all 10 columns in order even when empty`.
- [ ] **Step 2: Run** `npx vitest run web/test/store.test.ts` → FAIL. **Step 3: Implement** store + panels. **Step 4: Run** → PASS.
- [ ] **Step 5: Verify manually:** `npm run build:web && npm run dev`, open `http://127.0.0.1:4600`. The board shows 10 empty columns, chat accepts input, and the Inbox is empty.
- [ ] **Step 6: Commit** `feat(hq): founder UI shell, board, chat, inbox, drawer, inspector`

---

### Task 13: Pixel office

**Files:**
- Create: `hq/web/src/office/{layout,sprites,choreography,scene}.ts`; modify `hq/web/src/main.ts` (mount the scene in the Office tab)
- Test: `hq/web/test/layout.test.ts`, `hq/web/test/choreography.test.ts`

**Interfaces:**
- Produces (`layout.ts`): `TILE = 16`, `SCALE = 3`, `GRID = {w: 48, h: 30}`. `type Point = {x: number; y: number}` (tiles). `ROOMS: {id: 'founder'|'ceo'|'meeting'|'board'|DeptId; rect: {x,y,w,h}; door: Point; label: string}[]`. The approved layout A: row 1 = founder office (+ approval desk), CEO office (wide), meeting room. Row 2 = conception, software_cloud, **board wall (center)**, cybersecurity, network_infra. Row 3 = ai_automation, marketing_content, sales, finance_projects. Horizontal corridors run between the rows. Also `deskOf(agentId, deptOf: (id) => DeptId|null): Point` (lead desk + 3 desks per dept room; ceo in the CEO office), `spotIn(roomId): Point`, `isWalkable(p): boolean`, `pathBetween(a: Point, b: Point): Point[]` (out the door → corridor → target door → target; axis-aligned unit steps).
- Produces (`sprites.ts`): `makeSprites(color: string, kind: Role): {idle: Canvas; walk: [Canvas, Canvas]; type: [Canvas, Canvas]}`. These are procedural 16×16 canvases: the body is the dept color, the CEO is navy with a gold tie, a lead has a small badge.
- Produces (`choreography.ts`): `type Move = {agentId: string; to: 'desk'|'board'|'founder'|{desk: string}; thenReturn: boolean}` and `type Mood = {agentId: string; anim: 'idle'|'typing'; bubble: '?'|'zzz'|null}`. `react(e: CompanyEvent, lookup: {reviewerOf(id): string|null}): {moves: Move[]; moods: Mood[]}`. The mapping (pure, and **the only source of motion**):
  - `task.created` → the assigner walks to the board wall and returns
  - `run.updated` running → the agent types; ended → idle
  - `task.updated` → `in_review`: the assignee walks to its reviewer's desk and returns
  - `approval.updated` with a CEO recommendation → the ceo walks to the founder office and returns
  - `task.updated` → `failed`, or `project.updated` with blocked → the assignee gets a `?` bubble
  - `company.paused` until → everyone `zzz`; null → bubbles clear
  - anything else → nothing
- `scene.ts`: a requestAnimationFrame loop at 8 tiles/sec walking speed. It draws the floor, walls, room labels, desks and the board wall with live per-column counts, using pixelated scaling. Hover shows a title label, and a click calls `openInspector`.

- [ ] **Step 1: Write failing tests:** `every agent has a desk inside its own room`. `pathBetween is axis-aligned, walkable, and ends at target` (conception lead desk → ceo spot; finance desk → board). `react: task.created moves assigner to board and back`. `react: in_review sends specialist to lead desk`. `react: lead in_review goes to ceo desk`. `react: paused gives zzz to all, resume clears`. `react: chat.message produces no moves`.
- [ ] **Step 2: Run** `npx vitest run web/test` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Verify manually:** open the Office tab. All 33 agents sit at desks in the right rooms and nothing moves while idle (no fake motion). Trigger a ScriptedRunner-free action (POST `/api/ideas`, then `discuss`) and watch the CEO type during the chat run.
- [ ] **Step 6: Commit** `feat(hq): event-driven pixel office`

---

### Task 14: Business Model Sprint seed, README, end-to-end run

**Files:**
- Create: `hq/seeds/business-model-sprint.md`, `hq/scripts/seed-business-model.ts`, `hq/README.md`

**Interfaces:**
- Consumes: `Company.founderAddProject`, config, db.

`business-model-sprint.md` is the cahier des charges, built from spec §9 verbatim in substance:
- the question
- the five team deliverables
- the Tunisia / 100% virtual context
- TND with EUR and USD
- the four "must research" points (company form and registration costs incl. domiciliation and accountant; Startup Act label; paying USD SaaS and receiving foreign payments; Pro → Max → API path)
- "every price cited with source and date"
- outputs: `business-model.md` plus `costs.csv`, `revenue.csv`, `projection-12m.csv`

`seed-business-model.ts` adds it as a project titled **"Business Model Sprint"** in status `sharpening` (idempotent: it skips the seed if a project with that title exists).
`README.md` covers:
- install / build / run (`npm install`, `npm run build:web`, `npm run dev`, then open `http://127.0.0.1:4600`)
- `npm run probe` before the first use
- safety: agents have no credentials; never put passwords or client secrets in `hq/data/`; the Gate; the honest Windows egress limit
- Pro limits and the "on break" behaviour
- how to edit the founder profile
- config env vars

- [ ] **Step 1: Write** the seed file, the script and the README.
- [ ] **Step 2: Run** `npm run seed:bm` twice → one project only (check `GET /api/state`).
- [ ] **Step 3: End-to-end manual run:** `npm run dev`. In CEO chat: "This is our first job: the Business Model Sprint. Sharpen it with me." The CEO replies and updates the brief. Click **Accept brief**. Expected: the chief-architect gets a conception task (it walks to the board, then types), the board card moves to Conception, and the audit log shows each step. Let it run at least through the first lead review. If the usage limit hits, the "on break" banner shows the resume time.
- [ ] **Step 4: Run** `npm test` → all PASS.
- [ ] **Step 5: Commit** `feat(hq): business model sprint seed and README`
