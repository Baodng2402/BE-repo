export const ERROR_MESSAGES = {
  AUTH: {
    EMAIL_ALREADY_EXISTS: 'This email is already in use',
    INVALID_CREDENTIALS: 'Invalid email or password',
    ACCOUNT_NOT_LINKED: 'This account is not linked to the specified provider',
    INVALID_TOKEN_PAYLOAD: 'Invalid token payload',
    USER_NOT_FOUND: 'User not found',
    GITHUB_NOT_CONFIGURED: 'GitHub OAuth is not configured',
    GITHUB_TOKEN_EXCHANGE_FAILED: 'Failed to exchange code for token',
    GITHUB_OAUTH_FAILED: 'GitHub OAuth failed. Please try again.',
    INVALID_REDIRECT_URI: 'Invalid or missing redirect_uri',
    MISSING_PARAMETER: 'Missing required parameter',
    INVALID_OAUTH_STATE: 'Invalid or expired OAuth state',
    INVALID_PROVIDER: 'Invalid provider',
    JIRA_REQUIRES_HTTPS:
      'Jira OAuth requires HTTPS. Please configure domain + SSL first.',
  },
  GROUPS: {
    NOT_FOUND: 'Group not found',
    NOT_A_MEMBER: 'You are not a member of this group',
    USER_NOT_FOUND: 'User not found',
    ALREADY_A_MEMBER: 'User is already a member of this group',
    MEMBER_NOT_FOUND: 'Member not found in this group',
    CANNOT_REMOVE_LAST_LEADER:
      'Cannot remove the last leader. Assign another leader first.',
    CANNOT_LEAVE_AS_LAST_LEADER:
      'You are the last leader. Assign another leader before leaving.',
    ONLY_LEADERS_CAN_MANAGE: 'Only group leaders can perform this action',
  },
  TASKS: {
    NOT_FOUND: 'Task not found',
    GROUP_NOT_FOUND: 'Group not found',
    FORBIDDEN_READ:
      'You are not allowed to view tasks for a group you have not joined',
    FORBIDDEN_WRITE: 'Only group leaders can manage internal tasks',
    ASSIGNEE_NOT_IN_GROUP:
      'Assigned user must be an active member of the same group',
  },
  CLASSES: {
    NOT_FOUND: 'Class not found',
    ACCESS_DENIED: 'You do not have permission to view this class',
  },
  EVALUATIONS: {
    NOT_FOUND: 'Evaluation not found',
    GROUP_NOT_FOUND: 'Group not found',
    NOT_GROUP_MEMBER: 'You are not a member of this group',
    FORBIDDEN:
      'You do not have permission to manage evaluations for this group',
    SUM_NOT_100: 'Contribution percentages must sum to 100% (tolerance ±0.05)',
    MISSING_MEMBERS:
      'All active group members must be included in the evaluation',
    INVALID_MEMBER:
      'One or more user IDs do not belong to active members of this group',
    CONTRIBUTION_NOT_FOUND:
      'Your contribution was not found in this evaluation',
  },
  VALIDATION: {
    INVALID_EMAIL: 'Invalid email format',
    PASSWORD_TOO_SHORT: 'Password must be at least 6 characters',
    FULL_NAME_REQUIRED: 'Full name is required',
  },
} as const;

export const SUCCESS_MESSAGES = {
  AUTH: {
    ACCOUNT_UNLINKED: 'Account unlinked successfully',
    LOGGED_OUT: 'Logged out successfully',
  },
} as const;
