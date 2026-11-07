// Shared domain types for HQ.

export type Role = 'ceo' | 'lead' | 'specialist';

export type DeptId =
  | 'conception'
  | 'software_cloud'
  | 'cybersecurity'
  | 'network_infra'
  | 'ai_automation'
  | 'marketing_content'
  | 'sales'
  | 'finance_projects';

export type ToolProfile = 'ceo' | 'lead' | 'writer' | 'engineer';

export interface AgentDef {
  id: string;
  title: string;
  role: Role;
  dept: DeptId | null;
  leadId: string | null;
  section: string;
  duties: string[];
  notDuties: string[];
  toolProfile: ToolProfile;
}

export interface Department {
  id: DeptId;
  name: string;
  leadId: string;
  color: string;
}

export type ProjectStatus =
  | 'idea' | 'sharpening' | 'conception' | 'budgeting' | 'awaiting_approval'
  | 'in_progress' | 'awaiting_founder' | 'done' | 'rejected';

export type Phase = 'conception' | 'budgeting' | 'delivery' | 'report';

export type TaskStatus = 'queued' | 'running' | 'waiting_subtasks' | 'in_review' | 'rework' | 'done' | 'failed';

export type RunPurpose = 'work' | 'review' | 'compile' | 'plan_delivery' | 'triage' | 'recommend' | 'chat';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'paused';

export type Currency = 'TND' | 'EUR' | 'USD';

export interface Project {
  id: string;
  title: string;
  brief: string;
  status: ProjectStatus;
  blocked: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  phase: Phase;
  assigneeId: string;
  assignedById: string;
  title: string;
  instructions: string;
  status: TaskStatus;
  feedback: string | null;
  reworkCount: number;
  resultSummary: string | null;
  resultFiles: string[];
  /** Absolute paths HQ delivers to the assignee's inbox. */
  attachments: string[];
  failureReason: string | null;
  crossTeamRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  agentId: string;
  taskId: string | null;
  projectId: string | null;
  purpose: RunPurpose;
  status: RunStatus;
  sessionId: string | null;
  costUsd: number;
  error: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export type OutboundKind = 'email' | 'linkedin' | 'post' | 'proposal' | 'deployment' | 'purchase' | 'other';

export interface Approval {
  id: string;
  projectId: string;
  taskId: string;
  agentId: string;
  kind: OutboundKind;
  destination: string;
  subject: string | null;
  content: string;
  files: string[];
  status: 'pending' | 'approved' | 'rejected';
  ceoRecommendation: 'approve' | 'edit' | 'reject' | null;
  ceoNote: string | null;
  founderEdit: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ExternalCost {
  item: string;
  amount: number;
  currency: Currency;
  recurring: 'once' | 'monthly' | 'yearly';
  source?: string;
}

export interface Budget {
  projectId: string;
  estimatedRuns: number;
  estimatedAiUsd: number;
  externalCosts: ExternalCost[];
  clientPrice: { amount: number; currency: Currency } | null;
  notes: string;
  setBy: string;
  updatedAt: string;
}

export interface CrossTeamRequest {
  id: string;
  projectId: string;
  fromAgentId: string;
  targetDept: DeptId;
  need: string;
  status: 'open' | 'accepted' | 'declined';
  resolution: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  detail: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'founder' | 'ceo';
  text: string;
  at: string;
}
