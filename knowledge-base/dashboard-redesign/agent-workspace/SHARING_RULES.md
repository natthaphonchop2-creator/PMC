# Agent File Sharing Protocol

## Folder Rule

Each Agent owns one folder:

```text
11_Agent-Workspace/<agent-id>/
```

Agents write their own work only inside their own folder unless the user explicitly asks for broader project edits.

## Markdown Rule

All durable Agent work must be saved as `.md`.

Every saved work file should include this header:

```markdown
---
owner_agent: <agent-id>
status: draft | ready_for_review | final | archived
intended_readers:
  - <agent-id>
source_files:
  - <path>
handoff_to:
  - <agent-id>
updated_at: <ISO timestamp>
summary: <one sentence>
---
```

## Sharing Rule

To share work, specify source Agent, source markdown path, target Agent(s), and a handoff note.

The system records the share in:

- `11_Agent-Workspace/SHARE_INDEX.md`
- source Agent `shared-outbox.md`
- target Agent `shared-inbox.md`

Target Agents pick up the referenced source file. Do not duplicate shared files unless the user asks.
