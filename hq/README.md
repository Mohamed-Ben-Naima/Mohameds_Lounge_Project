# HQ: your AI-agent IT-services company

A local app that runs a 33-agent company on your Claude Code subscription: a CEO, 8 departments with 1 lead and 3 specialists each, a task board, an approval Gate, per-project budgets, and a pixel office where you watch them work.

## Run it

```bash
cd hq
npm install          # first time only
npm run build:web    # first time, and after UI changes
npm run probe        # first time: 2 small real runs that check the safety lockdown (all lines must say PASS)
npm run seed:bm      # adds your first project: the Business Model Sprint
npm run dev          # starts HQ
```

Open **http://127.0.0.1:4600**. HQ only listens on your own machine.

## How work flows

1. **You talk only to the CEO** (right sidebar). Give an idea or a ready cahier des charges.
2. The CEO sharpens it with you and keeps the brief up to date. When you agree, click **Accept brief** on the project card.
3. **Conception** designs it, then **Finance** budgets it. The card lands in **Needs your OK (plan)**: approve, revise or reject.
4. The CEO assigns delivery to the department leads. Leads split the work for their specialists and review it, and the CEO reviews the leads.
5. The CEO writes a final report. The card lands in **Needs your OK (delivery)**: accept it, or send it back.

Agents never talk to each other. Work moves only down and up the org chart, as tasks on the board, and code enforces this.

## Safety: what to know

- **Nothing leaves your PC without your click.** Emails, posts, proposals and deployments stop in your **Inbox** with the CEO's recommendation. In this MVP, approving gives you the final text and files, and you send them yourself.
- **Agents hold no passwords or keys.** They run with a stripped environment and no accounts for outside services. **Never put real passwords, API keys or client secrets in `hq/data/`.**
- Agents can search and read the web. Shell commands that send data out (curl, ssh, git push, scanners…) are blocked. On Windows this block is a denylist: strong, but not airtight. The real protection is that agents have nothing to send with.
- **Pentesting is off.** The Pentester writes plans and reports only.
- Research comes with sources, but agents can be wrong. Confirm legal, tax and price points (Startup Act, foreign-currency rules) with an accountant.

## Claude Pro limits

One agent works at a time. When Claude reports your usage limit, the company goes **on break**: the banner shows when work resumes, nothing is lost, and it continues on its own. Expect a project to take several usage windows. **Pause company** in the top bar stops all work until you resume.

## Your founder profile

The **Founder profile** tab holds what the CEO has learned about how you work. The CEO updates it, and you can correct it at any time.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `HQ_PORT` | 4600 | Port (always on 127.0.0.1) |
| `HQ_DATA_DIR` | `hq/data` | Database, agent desks, deliverables |
| `HQ_MAX_RUNS` | 1 | Agents working at once (raise after upgrading your plan) |
| `HQ_MODEL` | sonnet | Model for all agents |
| `HQ_CEO_MODEL` | sonnet | Model for the CEO (e.g. `opus`) |
| `HQ_COMPANY_NAME` | HQ | Name on the office sign |
| `HQ_RUN_TIMEOUT_MS` | 1200000 | Max time per agent run |

## Where things are

- `hq/data/projects/<id>/deliverables/`: every file the company produced, per task
- `hq/data/workspaces/<agent>/`: each agent's desk (notes, inbox, outbox)
- `hq/data/runs/<run>/stream.jsonl`: the full log of each agent run
- Click any agent in the office to see their job, recent runs, actions and notes.

## Tests

```bash
npm test         # 138 tests
npm run typecheck
```
