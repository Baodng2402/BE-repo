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
    CREATE_FORBIDDEN: 'Only lecturers or admins can create groups',
    NAME_ALREADY_EXISTS_IN_CLASS:
      'A group with this name already exists in the class',
    CLASS_MAX_GROUPS_EXCEEDED: 'Class has reached the maximum number of groups',
    USER_NOT_FOUND: 'User not found',
    ALREADY_A_MEMBER: 'User is already a member of this group',
    MEMBER_NOT_FOUND: 'Member not found in this group',
    CANNOT_REMOVE_LAST_LEADER:
      'Cannot remove the last leader. Assign another leader first.',
    CANNOT_LEAVE_AS_LAST_LEADER:
      'You are the last leader. Assign another leader before leaving.',
    ONLY_LEADERS_CAN_MANAGE: 'Only group leaders can perform this action',
    SOURCE_GROUP_NOT_IN_CLASS: 'Source group does not belong to any class',
    NOT_CLASS_LECTURER: 'You are not the lecturer of this class',
    MEMBER_NOT_IN_SOURCE_GROUP:
      'One or more specified users are not active members of the source group',
    DUPLICATE_MEMBER_IN_ASSIGNMENTS: 'Duplicate user_id found in assignments',
    TARGET_GROUP_NOT_FOUND: 'One or more target groups not found',
    TARGET_GROUP_NOT_ACTIVE: 'One or more target groups are not active',
    TARGET_GROUP_NOT_IN_SAME_CLASS:
      'All target groups must be in the same class as the source group',
    TARGET_GROUP_WOULD_EXCEED_MAX:
      'Reassignment would exceed the maximum group size',
    MEMBER_ALREADY_IN_TARGET_GROUP:
      'A member is already active in their assigned target group',
    CANNOT_MOVE_LAST_LEADER:
      'Cannot move the last leader while other members remain. Reassign the leader role first.',
    CANNOT_ARCHIVE_NON_EMPTY_GROUP:
      'Cannot archive the source group because it will still have remaining members',
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
  CHAT: {
    FORBIDDEN: 'You do not have access to this conversation',
    NOT_FOUND: 'Conversation not found',
    INVALID_CONTEXT:
      'Conversation must match a valid semester, class, student, and lecturer context',
    INVALID_PAYLOAD: 'Chat payload is invalid',
    DUPLICATE_CLIENT_ID:
      'A message with the same client_id already exists in this conversation',
    CLOSED: 'Conversation is closed',
    RATE_LIMITED: 'Too many chat messages. Please retry shortly.',
  },
  CLASSES: {
    NOT_FOUND: 'Class not found',
    ACCESS_DENIED: 'You do not have permission to view this class',
  },
  CHECKPOINTS: {
    WEEKS_NOT_ASCENDING:
      'Checkpoint deadline weeks must be strictly ascending (checkpoint 1 < 2 < 3).',
    INVALID_CHECKPOINT_NUMBERS:
      'Exactly 3 checkpoints (numbers 1, 2, 3) are required.',
    PUBLISHED_GRADES_LOCKED:
      'Cannot change deadline week — grades have already been published for this checkpoint.',
    NO_ACTIVE_SEMESTER: 'No active semester found.',
    UPCOMING_INTERACTION_FORBIDDEN:
      'This action is not available for UPCOMING semesters.',
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
  SRS: {
    DOCUMENT_NOT_FOUND: 'SRS document not found for this group',
    VERSION_NOT_FOUND: 'SRS version not found',
    NO_DRAFT_CONTENT: 'No draft content to create a version from',
    NOT_GROUP_MEMBER: 'You are not a member of this group',
    ONLY_LEADER_CAN_SUBMIT:
      'Only the group leader can submit versions for review',
    ONLY_LEADER_CAN_CREATE_VERSION: 'Only the group leader can create versions',
    ALREADY_HAS_PENDING_SUBMISSION:
      'This document already has a version pending review',
    VERSION_NOT_SUBMITTED: 'Only submitted versions can be reviewed',
    INVALID_REVIEW_STATUS:
      'Review status must be APPROVED or CHANGES_REQUESTED',
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
