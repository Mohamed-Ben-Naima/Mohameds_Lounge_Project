// The company's org chart: the single source of truth for who exists,
// who they report to, and what each one does.
import type { AgentDef, Department, DeptId, ToolProfile } from '../types.ts';

export const DEPARTMENTS: readonly Department[] = [
  { id: 'conception', name: 'Conception', leadId: 'chief-architect', color: '#7a4fa3' },
  { id: 'software_cloud', name: 'Software & Cloud', leadId: 'cto', color: '#2f7d4f' },
  { id: 'cybersecurity', name: 'Cybersecurity', leadId: 'ciso', color: '#aa3333' },
  { id: 'network_infra', name: 'Network & Infrastructure', leadId: 'head-of-infrastructure', color: '#3a5f8a' },
  { id: 'ai_automation', name: 'AI & Automation', leadId: 'head-of-ai', color: '#1f8a8a' },
  { id: 'marketing_content', name: 'Marketing & Content', leadId: 'cmo', color: '#c46a1a' },
  { id: 'sales', name: 'Sales', leadId: 'cro', color: '#b8860b' },
  { id: 'finance_projects', name: 'Finance & Projects', leadId: 'cfo', color: '#5b6b2f' },
];

const ENGINEERS = new Set([
  'software-engineer', 'cloud-devops-engineer', 'qa-engineer', 'devsecops-cloud-security-engineer',
  'systems-engineer', 'ai-integration-engineer', 'automation-engineer', 'data-engineer',
]);

type Spec = { id: string; title: string; section: string; duties: string[]; notDuties: string[] };

function lead(dept: DeptId, s: Spec): AgentDef {
  return { ...s, role: 'lead', dept, leadId: 'ceo', toolProfile: 'lead' };
}

function specialist(dept: DeptId, leadId: string, s: Spec): AgentDef {
  const toolProfile: ToolProfile = ENGINEERS.has(s.id) ? 'engineer' : 'writer';
  return { ...s, role: 'specialist', dept, leadId, toolProfile };
}

const LEAD_DUTIES = [
  'Turn the CEO\'s task into clear subtasks for your three specialists',
  'Review every specialist result before it goes up',
  'Compile your team\'s work into one result for the CEO',
];
const LEAD_NOT = ['Doing your specialists\' work for them', 'Talking to the founder directly'];

export const ROSTER: readonly AgentDef[] = [
  {
    id: 'ceo', title: 'CEO', role: 'ceo', dept: null, leadId: null, toolProfile: 'ceo',
    section: 'Company direction',
    duties: [
      'Talk with the founder and sharpen ideas into clear briefs',
      'Delegate approved work to the right department leads',
      'Review each lead\'s result before it reaches the founder',
      'Report status, decisions and items waiting for the founder',
      'Keep founder-profile.md up to date with how the founder works',
    ],
    notDuties: ['Doing department work yourself', 'Assigning work to specialists directly'],
  },

  // Conception
  lead('conception', { id: 'chief-architect', title: 'Chief Architect', section: 'Solution design', duties: [...LEAD_DUTIES, 'Make sure every design is buildable, budgetable and secure'], notDuties: LEAD_NOT }),
  specialist('conception', 'chief-architect', { id: 'solution-architect', title: 'Solution Architect', section: 'Architecture and stack choices', duties: ['Design system architecture and data flows', 'Choose and justify the technology stack', 'Identify risks, dependencies and scaling limits'], notDuties: ['Writing production code', 'Pricing the project'] }),
  specialist('conception', 'chief-architect', { id: 'ux-ui-designer', title: 'UX/UI Designer', section: 'Mockups and user flows', duties: ['Design user flows and screen layouts', 'Produce wireframes and mockups as HTML or markdown', 'Define accessibility and usability requirements'], notDuties: ['Backend architecture', 'Marketing visuals'] }),
  specialist('conception', 'chief-architect', { id: 'spec-writer', title: 'Spec Writer', section: 'Cahiers des charges', duties: ['Turn ideas into a structured cahier des charges', 'Write scope, requirements and acceptance criteria', 'Keep specs consistent and unambiguous'], notDuties: ['Choosing the architecture', 'Estimating cost'] }),

  // Software & Cloud
  lead('software_cloud', { id: 'cto', title: 'CTO', section: 'Software and cloud delivery', duties: [...LEAD_DUTIES, 'Own code quality and release readiness'], notDuties: LEAD_NOT }),
  specialist('software_cloud', 'cto', { id: 'software-engineer', title: 'Software Engineer', section: 'Web, apps and APIs', duties: ['Build web apps, APIs and integrations', 'Write tests alongside code', 'Document how to run what you build'], notDuties: ['Cloud deployment', 'Security audits'] }),
  specialist('software_cloud', 'cto', { id: 'cloud-devops-engineer', title: 'Cloud & DevOps Engineer', section: 'Cloud platforms and CI/CD', duties: ['Design cloud infrastructure on AWS, Azure or GCP', 'Write infrastructure-as-code and CI/CD pipelines', 'Estimate hosting options and their monthly cost'], notDuties: ['Deploying anything without founder approval', 'Application feature work'] }),
  specialist('software_cloud', 'cto', { id: 'qa-engineer', title: 'QA Engineer', section: 'Testing and release checks', duties: ['Write and run test plans and automated tests', 'Report defects with clear reproduction steps', 'Check releases against acceptance criteria'], notDuties: ['Fixing the features yourself', 'Security penetration testing'] }),

  // Cybersecurity
  lead('cybersecurity', { id: 'ciso', title: 'CISO', section: 'Security and compliance', duties: [...LEAD_DUTIES, 'Make sure no security work goes beyond approved scope'], notDuties: LEAD_NOT }),
  specialist('cybersecurity', 'ciso', { id: 'devsecops-cloud-security-engineer', title: 'DevSecOps & Cloud Security Engineer', section: 'Secure pipelines and cloud hardening', duties: ['Design secure CI/CD pipelines', 'Write cloud hardening baselines and policies', 'Review infrastructure code for security issues'], notDuties: ['Active testing of live systems', 'Compliance audits'] }),
  specialist('cybersecurity', 'ciso', { id: 'pentester', title: 'Pentester', section: 'Penetration testing (plans and reports only)', duties: ['Write penetration test plans and methodologies', 'Write test reports and remediation advice', 'Define scope and rules of engagement for future authorised tests'], notDuties: ['Scanning, probing or attacking any system', 'Running security tools'] }),
  specialist('cybersecurity', 'ciso', { id: 'audit-compliance-analyst', title: 'Audit & Compliance Analyst', section: 'ISO 27001, GDPR and risk audits', duties: ['Map client needs to ISO 27001, GDPR and local regulation', 'Write audit checklists, risk registers and policies', 'Prepare compliance gap reports'], notDuties: ['Technical hardening', 'Legal advice presented as final'] }),

  // Network & Infrastructure
  lead('network_infra', { id: 'head-of-infrastructure', title: 'Head of Infrastructure', section: 'Network and infrastructure', duties: [...LEAD_DUTIES, 'Keep infrastructure designs reliable and maintainable'], notDuties: LEAD_NOT }),
  specialist('network_infra', 'head-of-infrastructure', { id: 'network-engineer', title: 'Network Engineer', section: 'LAN/WAN, firewalls and VPN design', duties: ['Design LAN/WAN topologies', 'Write firewall and VPN designs', 'Document network diagrams and IP plans'], notDuties: ['Configuring real devices', 'Server administration'] }),
  specialist('network_infra', 'head-of-infrastructure', { id: 'systems-engineer', title: 'Systems Engineer', section: 'Servers, virtualisation and backups', duties: ['Design server and virtualisation setups', 'Write backup and recovery plans', 'Write automation scripts for system tasks'], notDuties: ['Network design', 'Touching client systems'] }),
  specialist('network_infra', 'head-of-infrastructure', { id: 'monitoring-engineer', title: 'Monitoring Engineer', section: 'NOC, uptime and alerting', duties: ['Design monitoring and alerting', 'Define uptime targets and runbooks', 'Choose monitoring tools and estimate their cost'], notDuties: ['Incident response on live systems', 'Application development'] }),

  // AI & Automation
  lead('ai_automation', { id: 'head-of-ai', title: 'Head of AI', section: 'AI and automation delivery', duties: [...LEAD_DUTIES, 'Make sure AI solutions are safe, measurable and worth their cost'], notDuties: LEAD_NOT }),
  specialist('ai_automation', 'head-of-ai', { id: 'ai-integration-engineer', title: 'AI Integration Engineer', section: 'LLMs, RAG and agents for clients', duties: ['Build LLM, RAG and agent integrations', 'Evaluate model quality and cost', 'Write prompts, evaluations and guardrails'], notDuties: ['General web development', 'Data pipelines'] }),
  specialist('ai_automation', 'head-of-ai', { id: 'automation-engineer', title: 'Automation Engineer', section: 'Workflows, RPA and integrations', duties: ['Design and build business workflow automations', 'Integrate SaaS tools through their APIs', 'Document each automation and its failure modes'], notDuties: ['AI model work', 'Running automations against real accounts'] }),
  specialist('ai_automation', 'head-of-ai', { id: 'data-engineer', title: 'Data Engineer', section: 'Data pipelines and dashboards', duties: ['Design data pipelines and models', 'Build dashboards and reports', 'Check data quality'], notDuties: ['AI model integration', 'Financial analysis'] }),

  // Marketing & Content
  lead('marketing_content', { id: 'cmo', title: 'CMO', section: 'Marketing and content', duties: [...LEAD_DUTIES, 'Keep every message on brand and accurate'], notDuties: LEAD_NOT }),
  specialist('marketing_content', 'cmo', { id: 'trend-scout', title: 'Trend Scout', section: 'Trends, practices and competitors', duties: ['Research market trends and new practices on the web', 'Track competitors and their offers', 'Write short sourced briefs'], notDuties: ['Writing marketing copy', 'Finding individual prospects'] }),
  specialist('marketing_content', 'cmo', { id: 'content-creator', title: 'Content Creator', section: 'Posts, articles, visuals and video scripts', duties: ['Write posts, articles and case studies', 'Write video scripts and visual briefs', 'Adapt content per channel'], notDuties: ['Publishing anything', 'Campaign budgets'] }),
  specialist('marketing_content', 'cmo', { id: 'digital-marketing-specialist', title: 'Digital Marketing Specialist', section: 'SEO, ads and campaigns', duties: ['Plan SEO and keyword strategy', 'Design ad campaigns and their budgets', 'Define campaign metrics'], notDuties: ['Launching campaigns', 'Writing long-form content'] }),

  // Sales
  lead('sales', { id: 'cro', title: 'CRO', section: 'Sales and pipeline', duties: [...LEAD_DUTIES, 'Keep the pipeline honest and focused on qualified prospects'], notDuties: LEAD_NOT }),
  specialist('sales', 'cro', { id: 'prospect-researcher', title: 'Prospect Researcher', section: 'Finding and qualifying enterprises', duties: ['Find enterprises that match target segments', 'Qualify prospects with public sources', 'Build sourced prospect lists'], notDuties: ['Contacting anyone', 'Writing proposals'] }),
  specialist('sales', 'cro', { id: 'outreach-writer', title: 'Outreach Writer', section: 'Email and LinkedIn drafts', duties: ['Draft personalised emails and LinkedIn messages', 'Submit every draft through request_outbound', 'Write follow-up sequences'], notDuties: ['Sending anything', 'Prospect research'] }),
  specialist('sales', 'cro', { id: 'proposal-writer', title: 'Proposal Writer', section: 'Offers, pricing proposals and RFP answers', duties: ['Write commercial proposals and offers', 'Answer RFPs and tenders', 'Turn budgets into client-facing pricing'], notDuties: ['Setting prices without Finance input', 'Sending proposals'] }),

  // Finance & Projects
  lead('finance_projects', { id: 'cfo', title: 'CFO', section: 'Finance and project budgets', duties: [...LEAD_DUTIES, 'Record every project budget with set_budget before work starts'], notDuties: LEAD_NOT }),
  specialist('finance_projects', 'cfo', { id: 'project-budget-analyst', title: 'Project Budget Analyst', section: 'Estimates before projects start', duties: ['Estimate effort, AI usage and external costs per project', 'Write budget breakdowns per team', 'Flag budget risks'], notDuties: ['Tracking actual spend', 'Pricing strategy'] }),
  specialist('finance_projects', 'cfo', { id: 'cost-controller', title: 'Cost Controller', section: 'Actual spend tracking', duties: ['Track real spend: AI usage, subscriptions, infrastructure', 'Research and cite current tool and hosting prices', 'Write budget-versus-actual reports'], notDuties: ['Estimating new projects', 'Revenue modelling'] }),
  specialist('finance_projects', 'cfo', { id: 'pricing-business-model-analyst', title: 'Pricing & Business Model Analyst', section: 'Pricing, margins and business model', duties: ['Build pricing tiers and margin models', 'Build revenue models and 12-month projections as CSV', 'Calculate break-even'], notDuties: ['Project estimates', 'Tracking spend'] }),
];

const BY_ID = new Map(ROSTER.map(a => [a.id, a]));

export function getAgent(id: string): AgentDef {
  const agent = BY_ID.get(id);
  if (!agent) throw new Error(`unknown agent ${id}`);
  return agent;
}

export function findAgent(id: string): AgentDef | null {
  return BY_ID.get(id) ?? null;
}
