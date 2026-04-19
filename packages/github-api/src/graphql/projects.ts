export const GET_PROJECT_ID_BY_NUMBER = /* GraphQL */ `
  query($owner: String!, $number: Int!) {
    user(login: $owner) { projectV2(number: $number) { id } }
    organization(login: $owner) { projectV2(number: $number) { id } }
  }
`;

export const GET_PROJECT_FIELDS = /* GraphQL */ `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 100) {
          nodes {
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField {
              id name dataType
              options { id name }
            }
          }
        }
      }
    }
  }
`;

export const GET_PROJECT_ITEM = /* GraphQL */ `
  query($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        content {
          ... on DraftIssue {
            title
            body
            assignees(first: 10) { nodes { login } }
          }
          ... on Issue {
            title
            body
            assignees(first: 10) { nodes { login } }
          }
          ... on PullRequest {
            title
            body
            assignees(first: 10) { nodes { login } }
          }
        }
        fieldValues(first: 50) {
          nodes {
            ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
          }
        }
      }
    }
  }
`;

export const LIST_PROJECT_ITEMS = /* GraphQL */ `
  query($projectId: ID!, $first: Int!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first) {
          nodes {
            id
            content {
              ... on DraftIssue {
                title
                body
                assignees(first: 10) { nodes { login } }
              }
              ... on Issue {
                title
                body
                assignees(first: 10) { nodes { login } }
              }
              ... on PullRequest {
                title
                body
                assignees(first: 10) { nodes { login } }
              }
            }
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
          }
        }
      }
    }
  }
`;

export const ADD_DRAFT_ISSUE = /* GraphQL */ `
  mutation($projectId: ID!, $title: String!, $body: String) {
    addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
      projectItem { id }
    }
  }
`;

export const UPDATE_DRAFT_ISSUE = /* GraphQL */ `
  mutation($draftId: ID!, $title: String, $body: String) {
    updateProjectV2DraftIssue(input: { draftIssueId: $draftId, title: $title, body: $body }) {
      draftIssue { id title body }
    }
  }
`;

export const UPDATE_PROJECT_FIELD_TEXT = /* GraphQL */ `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $text: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { text: $text }
    }) { projectV2Item { id } }
  }
`;

export const UPDATE_PROJECT_FIELD_SINGLE_SELECT = /* GraphQL */ `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) { projectV2Item { id } }
  }
`;

export const DELETE_PROJECT_ITEM = /* GraphQL */ `
  mutation($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) { deletedItemId }
  }
`;

export interface ProjectFieldNode {
  id: string;
  name: string;
  dataType: string;
  options?: { id: string; name: string }[];
}

export interface ProjectFieldValueNode {
  text?: string;
  number?: number;
  date?: string;
  name?: string;
  field: { name: string };
}

export interface ProjectItemNode {
  id: string;
  content?: {
    title?: string;
    body?: string | null;
    assignees?: { nodes: { login: string }[] };
  };
  fieldValues: { nodes: ProjectFieldValueNode[] };
}

export function fieldValuesToRecord(
  nodes: ProjectFieldValueNode[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const n of nodes) {
    if (!n?.field?.name) continue;
    const v = n.text ?? n.number ?? n.date ?? n.name;
    if (v !== undefined) out[n.field.name] = v;
  }
  return out;
}
