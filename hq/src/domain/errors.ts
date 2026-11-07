export type PolicyCode =
  | 'not_allowed'
  | 'not_your_report'
  | 'not_assignee'
  | 'not_reviewer'
  | 'wrong_status'
  | 'bad_transition'
  | 'already_decided'
  | 'bad_path'
  | 'subtasks_open'
  | 'budget_missing'
  | 'not_found';

/** A refusal by company rules. The message is shown to the agent or founder. */
export class PolicyError extends Error {
  readonly code: PolicyCode;
  constructor(code: PolicyCode, message: string) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}
