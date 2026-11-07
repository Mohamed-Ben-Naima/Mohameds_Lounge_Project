// The minimum tools each role needs. Built-in Claude Code tools plus HQ tools (via MCP).
import type { AgentDef } from '../types.ts';

const BASE = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

export function builtinToolsFor(agent: AgentDef): string[] {
  return agent.toolProfile === 'engineer' ? [...BASE, 'Bash'] : [...BASE];
}

const SPECIALIST = ['get_task', 'submit_result', 'request_outbound'];
const LEAD = [...SPECIALIST, 'create_subtask', 'review_result', 'request_cross_team'];
const CEO = ['get_task', 'get_board', 'create_project', 'update_brief', 'assign_to_lead', 'review_result', 'decline_cross_team', 'recommend_outbound', 'submit_result'];

export function mcpToolsFor(agent: AgentDef): string[] {
  if (agent.role === 'ceo') return [...CEO];
  if (agent.role === 'lead') return agent.id === 'cfo' ? [...LEAD, 'set_budget'] : [...LEAD];
  return [...SPECIALIST];
}
