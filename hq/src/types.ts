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
