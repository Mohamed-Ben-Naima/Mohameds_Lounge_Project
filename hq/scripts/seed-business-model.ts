// Adds the Business Model Sprint as the company's first project (in Sharpening). Safe to run twice.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db/db.ts';
import * as projects from '../src/db/repos/projects.ts';
import { EventBus } from '../src/events/bus.ts';
import { Company } from '../src/domain/company.ts';
import { Workspaces } from '../src/workspace/workspaces.ts';
import { HQ_ROOT, loadConfig } from '../src/config.ts';

const TITLE = 'Business Model Sprint';
const config = loadConfig(process.env);
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'hq.sqlite'));
const existing = projects.list(db).find(p => p.title === TITLE);
if (existing) {
  console.log(`"${TITLE}" already exists (${existing.id}, ${existing.status}). Nothing to do.`);
} else {
  const ws = new Workspaces(config.dataDir);
  ws.ensureAll();
  const brief = fs.readFileSync(path.join(HQ_ROOT, 'seeds', 'business-model-sprint.md'), 'utf8');
  const p = new Company(db, new EventBus(), ws).founderAddProject({ title: TITLE, brief, status: 'sharpening' });
  console.log(`Added "${TITLE}" (${p.id}) in Sharpening. Open HQ and talk it through with the CEO, then click "Accept brief".`);
}
db.close();
