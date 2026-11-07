# AI Agent IT-Services Company — MVP Design

Date: 2026-11-07 · Status: draft for founder approval

## 1. Intent

The founder is building a startup that sells IT services to enterprises: software, cloud, cybersecurity, network, automation, AI integration, digital content and digital marketing. The work is delivered by a company of AI agents. Each agent has one clear role and the hierarchy is the kind a company needs to scale.

The founder talks only to the **CEO**, handing over either a ready cahier des charges or a rough idea. The CEO sharpens it with the founder, gets it designed and budgeted, delegates it down the hierarchy, and reports back. Over time the CEO learns how the founder works, and the company looks for trends and prospects on its own.

The company is **visible**: a pixel-art open-floor office where the founder watches agents work and move around. Every movement reflects something real. A **task board** shows the progress of every project.

**Why this matters:** "no noise". Every agent is independent, does only its own job, and communicates only along the hierarchy. The founder wants something smartly built that can scale, with no agents chattering and no fake activity.

**Approach:** MVP first. Make it work end to end, then fix, refactor and improve.

## 2. Goals (MVP)

1. All 8 departments and 33 agents (CEO + 8 leads + 24 specialists) are defined, appear in the office, and can be given real work.
2. The full chain works on real tasks: Founder → CEO → Lead → Specialist → Lead review → CEO → Founder.
3. Agents **plan and execute** real work: they write code, documents, specs, research and spreadsheets in their own workspaces, and they read the internet (search and fetch) for research, trends and prospects.
4. **The Gate:** nothing that reaches a real person or leaves the machine happens without the founder's explicit approval.
5. **Every project is budgeted** by Finance before work starts, and budget vs. actual is shown at the end.
6. **Task board** with the full project lifecycle, live.
7. **CEO chat** in the office UI, with continuity across messages and a founder-profile memory the founder can read and edit.
8. **First real job:** the Business Model Sprint (§9).

## 3. Non-goals (MVP)

- Automatic sending of anything (email, LinkedIn, posts). Approved items are handed to the founder ready to send, and the founder sends them by hand. Send integrations come later, still behind the Gate.
- Active pentesting or scanning of any system. In the MVP the Pentester produces methodology, test plans and reports only.
- Deploying HQ to the cloud, multiple users, client-facing portals, invoicing clients.
- Polished pixel art. MVP sprites are simple, so the effort goes into making the system correct first.
- Scheduled or autonomous prospecting runs. The MVP runs on the founder's request only.

## 4. Anti-goals (a failure even if it "works")

- Agents talking to each other outside the hierarchy, or one agent doing another team's job.
- Fake animation: agents walking around when nothing is happening.
- Anything leaving the machine without the founder's click.
- A safety rule that exists only as an instruction in a prompt, where code could enforce it instead.
- Runaway usage: dozens of agent runs firing at once and burning the subscription.

## 5. The organisation

```
Founder
  └─ CEO  (talks to Founder + 8 Leads only)
       ├─ Conception ............ Chief Architect: Solution Architect · UX/UI Designer · Spec Writer
       ├─ Software & Cloud ...... CTO: Software Engineer · Cloud & DevOps Engineer · QA Engineer
       ├─ Cybersecurity ......... CISO: DevSecOps & Cloud Security Eng. · Pentester · Audit & Compliance Analyst
       ├─ Network & Infra ....... Head of Infrastructure: Network Engineer · Systems Engineer · Monitoring Engineer
       ├─ AI & Automation ....... Head of AI: AI Integration Engineer · Automation Engineer · Data Engineer
       ├─ Marketing & Content ... CMO: Trend Scout · Content Creator · Digital Marketing Specialist
       ├─ Sales ................. CRO: Prospect Researcher · Outreach Writer · Proposal Writer
       └─ Finance & Projects .... CFO: Project Budget Analyst · Cost Controller · Pricing & Business Model Analyst
```

### Communication rules (enforced by HQ code, not by prompts)

1. Agents never message each other. All work moves as **tasks on the board**.
2. Work goes down and results come up, along the chart only. A specialist receives tasks only from its own lead, a lead only from the CEO, and the CEO only from the founder.
3. A lead can only assign subtasks to its own 3 specialists. The CEO can only assign to leads.
4. If a lead needs another team, it files a **cross-team request** to the CEO, and the CEO decides whether to create a task for that team.
5. Every result is reviewed one level up before it moves on. Specialist output is reviewed by its lead, a lead's output by the CEO, and the CEO's report goes to the founder.
6. Rework loops are capped at 2 per review. After that the item escalates one level up, so it can't loop forever.

### Agent independence

Each agent has its own:
- **Job description file**: role, section, what it does and does not do, its lead, and its output format.
- **Workspace folder**, where it works. Other teams can't read it.
- **Tool permissions**, which are the minimum its job needs (§7.3).
- **Notes file**: its own working memory across tasks (MVP: a markdown file it reads at the start of each task and appends to at the end).

Deliverables move between agents only by being **attached to a task**. HQ copies the files into the task's deliverables folder, and only the next assignee in the chain receives them.

## 6. Project lifecycle and the board

Board columns, as statuses:

`Idea → Sharpening → Conception → Budgeting → Awaiting founder approval → In progress → Lead review → CEO review → Awaiting founder (deliverable / outbound) → Done`

Plus `Blocked` (a flag, not a column) and `Rejected`.

- **Projects** move through the columns. **Tasks** belong to projects and have their own status (`queued · running · in review · rework · done · failed`). The board shows projects as cards. Opening a card shows its task tree, with who has each task, its status, and its deliverables.
- **Sharpening:** the CEO and the founder refine the idea in chat until the CEO writes a one-page brief the founder accepts.
- **Conception:** the Chief Architect's team produces the design or cahier des charges.
- **Budgeting:** the CFO's team produces the project budget (§8).
- **Awaiting founder approval:** the founder approves or rejects the design and budget together. Nothing is built before this.
- **Done:** shows budget vs. actual.

## 7. How it is built

### 7.1 Overall shape (builder's call unless noted)

A single local app, **HQ**, running on the founder's Windows PC:

- **HQ server** (Node.js 24 + TypeScript). It owns the database, the hierarchy rules, the Gate, the run queue and the event stream.
- **SQLite database** for agents, projects, tasks, deliverables, budgets, approvals, the audit log and chat history.
- **Agent runner.** Each task runs as a fresh **Claude Code headless run** (`claude -p`) on the founder's existing Claude Code subscription (decided: the founder has Claude Code; no separate API key for the MVP). Each run gets the agent's job description as its system prompt, the agent's workspace as its working directory, and the agent's tool allow/deny list. It streams JSON events back to HQ so the office and board update live.
- **HQ MCP server.** This is the only way agents act on the company. It exposes role-scoped tools (`create_subtask`, `submit_result`, `review_result`, `request_cross_team`, `request_outbound`, `get_task`, `read_attachment`). Each run carries an identity token, and HQ refuses any call the hierarchy doesn't allow.
- **Office UI** in the browser at `localhost`: the pixel office, board, CEO chat, Approval Inbox, budgets and an agent inspector. Live updates come over WebSocket.

### 7.2 Run queue

The founder is on **Claude Pro** (decided). Pro has the tightest usage limits, so the queue is built around them:

- **One agent run at a time** by default (configurable for when the plan is upgraded).
- Model per role is configurable. Default: Sonnet for everyone. Opus is reserved for the CEO and only switched on when the founder chooses. *(Builder's call, made for Pro limits.)*
- Small, focused tasks. Leads split work so each run is short. This saves usage and fits the "one job per agent" rule.
- **Usage-limit aware.** When Claude reports a usage limit, the queue pauses, the board shows when work resumes, and the office shows the company "on break". Nothing is lost, and the queue continues once the limit resets.
- Every run has a turn limit and a timeout. A failed run marks the task `failed`, and the lead decides whether to retry.
- Expectation, stated plainly: on Pro the company works in **bursts**. The Business Model Sprint will likely take several usage windows (spread over a day or more), not minutes. Upgrading the plan is itself a line item in the business model.

### 7.3 The Gate and safety (decided: anything leaving the machine goes through the founder)

Layers, strongest first:

1. **Agents hold no outside credentials.** No email passwords, social tokens, cloud keys or payment details exist anywhere an agent can reach. This is the real control: an agent can't send an email it has no account to send from.
2. **Outbound happens only through `request_outbound`.** An agent that wants something to leave (an email, post, proposal to a client, deployment, purchase) files a request with the exact content and destination. It lands in the **Approval Inbox** with the CEO's recommendation. The founder approves, edits or rejects it. In the MVP, approval hands the founder the final ready-to-send item to send by hand.
3. **Least-privilege tools.** Only roles that genuinely need to run code (the engineers) get a shell. Writing roles get file read/write in their own workspace plus web search/fetch.
4. **Egress hook.** A Claude Code `PreToolUse` hook on every run blocks shell commands that send data out (curl/wget/Invoke-WebRequest, ssh/scp, git push, package publish, mail tools, and so on), and blocks file access outside the agent's workspace.
5. **Audit log.** Every tool call, task change and approval is recorded with who, what and when.

**Known limit, stated honestly:** on native Windows the egress hook is a denylist. A determined workaround could slip past it, and web fetch can carry data in a URL. Layer 1 is what keeps this safe in the MVP. Hardening comes after the MVP: run agent shells inside WSL2/Docker with a network allowlist.

**Pentesting rule:** active testing is disabled in the MVP. When it's enabled later, it requires a founder-approved scope record (client, written authorisation, targets, dates), and the tools only accept targets on that record.

### 7.4 The office (decided: one open floor, layout A)

```
[ Founder office + approval desk ] [        CEO office        ] [ Meeting room ]
[ Conception ] [ Software & Cloud ] [ ▦ BOARD WALL ▦ ] [ Cybersecurity ] [ Network & Infra ]
[ AI & Automation ] [ Marketing & Content ] [ Sales ] [ Finance & Projects ]
```
(The exact grid is the builder's call. Every department needs a room with a lead desk and 3 specialist desks, and the board wall must be central.)

- Top-down pixel art, rendered in the browser. MVP sprites are simple and colour-coded per department, with a role label on hover.
- **Every animation maps to a real event:**
  - idle at desk (no task) · typing at desk (run in progress)
  - walking to the lead's desk (submitting a result) · walking to the CEO's office (a lead reporting)
  - walking to the board wall (a task created or moved)
  - "?" bubble (blocked or waiting) · walking to the founder's office (an item entering the Approval Inbox)
- Clicking an agent opens the inspector: role, lead, current task, recent actions, notes file.
- The pixel-art library (Phaser 3, PixiJS or plain canvas) is the builder's call. Art must be self-made or CC0.

### 7.5 CEO chat and memory

- A chat panel in the founder's office, available at any time.
- Continuity: the CEO's conversation session is resumed across messages.
- **Founder profile:** a markdown file the CEO reads at the start of each conversation and updates when it learns something about how the founder works (standards, preferences, decisions). The founder can view and edit it in the UI.
- From chat the CEO can: start sharpening an idea, accept a cahier des charges as a new project, report status, explain decisions, and summarise what is waiting for the founder.

## 8. Project budgets

Every project gets a budget record, made in the Budgeting column:

- **Estimated effort:** tasks per team and agent runs.
- **AI usage cost:** estimated, then actual. Actual comes from the cost each run reports (an API-equivalent figure). On the subscription the real marginal cost is the flat fee, but the API-equivalent figure is what the business model needs once the company scales onto the API.
- **External costs:** tools, subscriptions, infrastructure the project needs.
- **Price to client and margin**, when it's client work.
- At Done: budget vs. actual, per team.

## 9. First job: the Business Model Sprint

The founder hands the CEO this as the company's first project. It goes through the normal lifecycle, so the sprint also tests the system.

**Question:** what does this company cost to run, how does it make money, and when does it break even?

| Team | Deliverable |
|---|---|
| Finance & Projects (lead) | Cost model: Claude subscription/API tiers, hosting for HQ when it moves to the cloud, domain and email, CRM, LinkedIn Sales Navigator, design and security tools, hardware (workstation, backup), company registration, legal, insurance. Revenue model per service line (fixed-price projects, monthly retainers / managed services). 12-month projection, break-even, pricing tiers. |
| Conception | Architecture of the company's own platform at 3 scales (MVP on one PC → small cloud → scaled), as input to infrastructure costs. |
| Software & Cloud | Hosting cost options for each of those scales. |
| Marketing & Content | Market scan: AI-agent IT-services trends and competitors, with sources. |
| Sales | Target segments: which enterprises buy which service lines first, typical deal sizes, with sources. |

Every price is researched online and **cited with its source and date**. Output: one business model document plus a spreadsheet (costs, revenue, 12-month projection) in the project's deliverables.

**Context for the sprint (decided by the founder):**
- The company is registered in **Tunisia** and is **100% virtual**: no office rent, and the founder works from a home PC.
- Prices are in **TND**, with **EUR and USD** alongside, since many tools are billed in USD and enterprise clients may be abroad.

**Points the sprint must research (not assumed here):**
- Tunisian company form and registration costs for a virtual company, including domiciliation and the accountant.
- Whether the company qualifies for the Tunisian **Startup Act** label, and what that changes (taxes, social charges, foreign-currency account).
- How a Tunisian company pays foreign SaaS subscriptions in USD and receives payment from foreign clients, including the practical limits.
- Claude plan path: Pro now → Max → API at scale, with the cost of each.

## 10. Builder's choices (not decided by the founder)

UI framework and pixel library · DB access layer · exact MCP tool shapes · exact hook rules · office grid · sprite style · folder layout · test approach.

Also settled as builder's calls:
- **Language:** UI in English, and agents reply in the language the founder writes in.
- **Company name:** placeholder "HQ" until the founder picks one. It appears on the office sign and in documents.
- **Code location:** a new `hq/` folder in the project root, under git.
- **Model defaults and one-run-at-a-time:** see §7.2.

## 11. Open questions for the founder

None open. Plan tier, country and currency are answered above.
