# PMC Home Command Center Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Home screen into a safer platform hub with a typed tool registry, tested status contracts, route-safe launcher behavior, and visual guardrails that prevent decorative logo misuse.

**Architecture:** Keep Home isolated under `src/apps/home/*` and keep `src/App.tsx` responsible only for routing to Home, Ads Agent, and Page Automation. Home data remains read-only and is composed from existing local APIs, with failed or missing endpoints represented as setup/unavailable states. Future tools such as ERP, CRM, Website Insight, and Knowledge are represented through a registry so UI and status behavior stay consistent without fake operational metrics.

**Tech Stack:** React 19, TypeScript, Vite, Vitest SSR rendering tests, existing Vite server API plugins, `lucide-react`, plain CSS module-by-route file.

---

## File Structure

- Modify: `src/apps/home/types.ts`
  - Own shared Home domain types: tool ids, route states, status states, priorities, activities, and snapshots.
- Create: `src/apps/home/toolRegistry.ts`
  - Own the canonical Home tool list, future-module setup states, system status labels, hrefs, and disabled reasons.
- Modify: `src/apps/home/api.ts`
  - Compose Home snapshots from API status results and the registry. Keep network timeouts and no-invented-status policy here.
- Modify: `src/apps/home/HomeApp.tsx`
  - Render only registry-backed tools and safe route actions. Do not include generated/logo image decoration.
- Modify: `src/apps/home/styles.css`
  - Style disabled/setup tool states and keep the current clean reference look.
- Modify: `tests/homeApp.test.tsx`
  - Keep route/render tests and add visual guardrails.
- Create: `tests/homeApi.test.ts`
  - Unit-test Home snapshot behavior with mocked `fetch`.

---

### Task 1: Add Home API Contract Tests

**Files:**
- Create: `tests/homeApi.test.ts`
- Modify: `src/apps/home/api.ts`

- [ ] **Step 1: Write failing tests for status composition**

Create `tests/homeApi.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHomeSnapshot, fetchHomeStatusSnapshot } from '../src/apps/home/api'

describe('Home API snapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows connected states only when the status APIs explicitly return connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/meta/status') return json({ configured: true, connected: true })
      if (url === '/api/ai/status') return json({ configured: true, connected: true, model: 'gpt-5.5' })
      if (url === '/api/page-automation/status') return json({ ok: true, storage: 'ready', autoMode: 'off' })
      if (url === '/api/page-automation/messages') return json({ messages: [] })
      if (url === '/api/page-automation/post-drafts') return json({ drafts: [] })
      return json({ actions: [], auditTrail: [] })
    }))

    const snapshot = await fetchHomeStatusSnapshot()

    expect(snapshot.headerStatuses).toEqual([
      expect.objectContaining({ id: 'meta', state: 'connected', value: 'เชื่อมต่อ' }),
      expect.objectContaining({ id: 'ai', state: 'connected', value: 'เชื่อมต่อ' }),
      expect.objectContaining({ id: 'knowledge', state: 'ready', value: 'พร้อมใช้งาน' }),
    ])
    expect(snapshot.tools.find((tool) => tool.id === 'page')).toEqual(expect.objectContaining({ status: 'ready', statusText: 'พร้อมใช้งาน' }))
  })

  it('does not invent connected states when endpoints fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    const snapshot = await fetchHomeSnapshot()

    expect(snapshot.headerStatuses).toEqual([
      expect.objectContaining({ id: 'meta', state: 'unavailable', value: 'ไม่พร้อมใช้งาน' }),
      expect.objectContaining({ id: 'ai', state: 'unavailable', value: 'ไม่พร้อมใช้งาน' }),
      expect.objectContaining({ id: 'knowledge', state: 'setup', value: 'รอตั้งค่า' }),
    ])
    expect(snapshot.systemStatuses.find((status) => status.id === 'erp')).toEqual(expect.objectContaining({ state: 'setup', value: 'รอตั้งค่า' }))
    expect(snapshot.systemStatuses.find((status) => status.id === 'crm')).toEqual(expect.objectContaining({ state: 'setup', value: 'รอตั้งค่า' }))
  })

  it('keeps exactly three priorities without fake unread or draft counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/meta/status') return json({ configured: true, connected: true })
      if (url === '/api/ai/status') return json({ configured: true, connected: true })
      if (url === '/api/page-automation/status') return json({ ok: true, storage: 'ready' })
      if (url === '/api/page-automation/messages') return json({ messages: [] })
      if (url === '/api/page-automation/post-drafts') return json({ drafts: [] })
      return json({ actions: [], auditTrail: [] })
    }))

    const snapshot = await fetchHomeSnapshot()

    expect(snapshot.priorities).toHaveLength(3)
    expect(snapshot.priorities.map((priority) => priority.title).join(' ')).not.toMatch(/12|3 รายการ/)
    expect(snapshot.priorities.map((priority) => priority.source)).toEqual(['Ads Agent', 'Page Automation', 'Page Automation'])
  })
})

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 2: Run the new test and verify it fails before registry/status refactor**

Run:

```bash
npm run test -- tests/homeApi.test.ts
```

Expected: FAIL if current snapshot behavior does not match the exact states above, or PASS if current behavior already satisfies the contract. Record the result in the task notes before editing implementation.

- [ ] **Step 3: Export only the functions needed by the test**

Confirm `src/apps/home/api.ts` exports these functions:

```ts
export async function fetchHomeStatusSnapshot(): Promise<HomeSnapshot> {
  // existing implementation remains public for HomeApp and tests
}

export async function fetchHomeSnapshot(): Promise<HomeSnapshot> {
  // existing implementation remains public for HomeApp and tests
}
```

- [ ] **Step 4: Run the focused test again**

Run:

```bash
npm run test -- tests/homeApi.test.ts
```

Expected: PASS after Task 1 implementation is complete.

---

### Task 2: Extract The Home Tool Registry

**Files:**
- Create: `src/apps/home/toolRegistry.ts`
- Modify: `src/apps/home/types.ts`
- Modify: `src/apps/home/api.ts`

- [ ] **Step 1: Add registry-oriented types**

Modify `src/apps/home/types.ts` to include explicit ids and route state:

```ts
export type HomeStatusState = 'loading' | 'connected' | 'ready' | 'setup' | 'unavailable'

export type HomeRisk = 'สูง' | 'ปานกลาง' | 'ต่ำ'

export type HomeToolId = 'ads' | 'page' | 'erp' | 'crm' | 'website' | 'knowledge'

export type HomeRouteState = 'enabled' | 'setup' | 'disabled'

export type HomeSystemStatus = {
  id: string
  label: string
  state: HomeStatusState
  value: string
}

export type HomePriority = {
  id: string
  actionLabel: 'Review' | 'Open'
  confidence: number
  href: string
  iconTone: 'blue' | 'green' | 'purple' | 'orange'
  risk: HomeRisk
  source: string
  sourceLabel: string
  title: string
}

export type HomeTool = {
  id: HomeToolId
  href: string
  iconTone: 'blue' | 'green' | 'purple' | 'orange'
  routeState: HomeRouteState
  setupLabel?: string
  status: HomeStatusState
  statusText: string
  title: string
}
```

- [ ] **Step 2: Create the registry file**

Create `src/apps/home/toolRegistry.ts`:

```ts
import type { HomeStatusState, HomeTool, HomeToolId } from './types'

type HomeToolDefinition = {
  id: HomeToolId
  href: string
  iconTone: HomeTool['iconTone']
  routeState: HomeTool['routeState']
  setupLabel?: string
  title: string
}

export const homeToolDefinitions: HomeToolDefinition[] = [
  { id: 'ads', href: '/ads-agent', iconTone: 'blue', routeState: 'enabled', title: 'Ads Agent' },
  { id: 'page', href: '/page-automation', iconTone: 'green', routeState: 'enabled', title: 'Page Automation' },
  { id: 'erp', href: '#erp', iconTone: 'orange', routeState: 'setup', setupLabel: 'ยังไม่มี ERP connector', title: 'ERP' },
  { id: 'crm', href: '#crm', iconTone: 'purple', routeState: 'setup', setupLabel: 'ยังไม่มี CRM connector', title: 'CRM' },
  { id: 'website', href: '#website-insight', iconTone: 'blue', routeState: 'setup', setupLabel: 'ยังไม่มี Website Insight connector', title: 'Website Insight' },
  { id: 'knowledge', href: '#knowledge', iconTone: 'green', routeState: 'setup', setupLabel: 'รอออกแบบ RAG workflow', title: 'Knowledge' },
]

export function buildHomeTool(definition: HomeToolDefinition, state: HomeStatusState, statusText: string): HomeTool {
  return {
    id: definition.id,
    href: definition.href,
    iconTone: definition.iconTone,
    routeState: definition.routeState,
    setupLabel: definition.setupLabel,
    status: state,
    statusText,
    title: definition.title,
  }
}
```

- [ ] **Step 3: Replace repeated tool literals in `api.ts`**

In `src/apps/home/api.ts`, import the registry:

```ts
import { buildHomeTool, homeToolDefinitions } from './toolRegistry'
```

Replace the `tools: [...]` literal inside `composeHomeSnapshot()` with:

```ts
const toolStateById = {
  ads: {
    state: metaStatus.state,
    text: metaStatus.state === 'connected' ? 'พร้อมใช้งาน' : metaStatus.value,
  },
  page: {
    state: pageToolStatus,
    text: pageToolText,
  },
  erp: { state: 'setup' as const, text: 'รอตั้งค่า' },
  crm: { state: 'setup' as const, text: 'รอตั้งค่า' },
  website: { state: 'setup' as const, text: 'รอตั้งค่า' },
  knowledge: {
    state: knowledgeStatus.state,
    text: knowledgeStatus.value,
  },
}

const tools = homeToolDefinitions.map((definition) => {
  const state = toolStateById[definition.id]
  return buildHomeTool(definition, state.state, state.text)
})
```

Then set:

```ts
tools,
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test -- tests/homeApi.test.ts tests/homeApp.test.tsx
```

Expected: both test files PASS.

---

### Task 3: Add Safe Launcher Behavior For Setup Modules

**Files:**
- Modify: `src/apps/home/HomeApp.tsx`
- Modify: `src/apps/home/styles.css`
- Modify: `tests/homeApp.test.tsx`

- [ ] **Step 1: Add render test for setup modules**

Append this test to `tests/homeApp.test.tsx`:

```tsx
it('marks future modules as setup launchers instead of pretending they are live routes', () => {
  const html = renderToStaticMarkup(<HomeApp />)

  expect(html).toContain('ยังไม่มี ERP connector')
  expect(html).toContain('ยังไม่มี CRM connector')
  expect(html).toContain('ยังไม่มี Website Insight connector')
  expect(html).toContain('รอออกแบบ RAG workflow')
})
```

- [ ] **Step 2: Update `ToolTile` markup**

Replace `ToolTile` in `src/apps/home/HomeApp.tsx` with:

```tsx
function ToolTile({ tool }: { tool: HomeTool }) {
  const Icon = toolIcons[tool.id] ?? Grid2X2
  const isSetup = tool.routeState !== 'enabled'
  return (
    <a className={`home-tool-tile ${isSetup ? 'is-setup' : ''}`} href={tool.href} aria-disabled={isSetup ? 'true' : undefined} title={tool.setupLabel}>
      <div className={`home-tool-icon ${tool.iconTone}`}>
        <Icon size={26} />
      </div>
      <div>
        <strong>{tool.title}</strong>
        <span><i className={`home-dot ${statusStateClass(tool.status)}`} />{tool.statusText}</span>
        {tool.setupLabel ? <em>{tool.setupLabel}</em> : null}
      </div>
      <ChevronRight size={17} />
    </a>
  )
}
```

- [ ] **Step 3: Style setup labels without adding visual clutter**

Append to `src/apps/home/styles.css` near `.home-tool-tile span`:

```css
.home-tool-tile em {
  display: block;
  margin-top: 5px;
  color: #7a8796;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  line-height: 1.25;
}

.home-tool-tile.is-setup {
  background: #fffefd;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS.

---

### Task 4: Add Visual Guardrails Against Logo Decoration Misuse

**Files:**
- Modify: `tests/homeApp.test.tsx`
- Modify: `src/apps/home/HomeApp.tsx`
- Modify: `src/apps/home/styles.css`

- [ ] **Step 1: Add a regression test for no decorative logo images**

Append this test to `tests/homeApp.test.tsx`:

```tsx
it('does not use the PMC logo image as repeated decoration on Home', () => {
  const html = renderToStaticMarkup(<HomeApp />)

  expect(html).not.toContain('/promedclinicpmc-logo.png')
  expect(html).not.toContain('home-tool-watermark')
  expect(html).not.toContain('home-chip-mark')
  expect(html).not.toContain('home-action-mark')
})
```

- [ ] **Step 2: Run the guard test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS. If it fails, remove logo image markup from `src/apps/home/HomeApp.tsx` and remove matching classes from `src/apps/home/styles.css`.

- [ ] **Step 3: Search for forbidden Home decoration references**

Run:

```bash
rg -n "promedclinicpmc-logo|home-tool-watermark|home-chip-mark|home-action-mark" src/apps/home tests/homeApp.test.tsx
```

Expected: only the regression test contains those strings.

---

### Task 5: Full Verification And Browser QA

**Files:**
- Modify only if checks reveal a concrete issue: `src/apps/home/*`, `tests/home*.test.*`

- [ ] **Step 1: Run Home tests**

Run:

```bash
npm run test -- tests/homeApi.test.ts tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm run test
```

Expected: PASS with all current test files.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. Vite chunk-size warning is acceptable unless a new error appears.

- [ ] **Step 5: Verify local routes**

Run:

```bash
curl -s -o /tmp/pmc-home.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:5173/
curl -s -o /tmp/pmc-ads.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:5173/ads-agent
curl -s -o /tmp/pmc-page.html -w '%{http_code} %{content_type}\n' http://127.0.0.1:5173/page-automation
```

Expected:

```text
200 text/html
200 text/html
200 text/html
```

- [ ] **Step 6: Capture desktop visual evidence**

Use Chrome CDP or the in-app Browser tool to capture `http://127.0.0.1:5173/` at `1600x1067`.

Expected visual checks:
- Left sidebar shows text brand `PMC COMMAND CENTER`, not repeated logo images.
- Header status chips show Meta API, AI API, Knowledge.
- AI Priorities has three rows.
- Tools contains Ads Agent, Page Automation, ERP, CRM, Website Insight, Knowledge.
- System Status contains Meta API, AI API, RAG / Knowledge, Website, ERP, CRM.
- No decorative logo watermark appears on buttons, tools, or status chips.

---

## Self-Review

- Spec coverage: Home route, tool launcher, system status, safety boundary, future modules, and no fake metrics are covered by Tasks 1-5.
- Placeholder scan: This plan contains no incomplete-marker placeholders, no copied-step shortcuts, and no undefined implementation steps.
- Type consistency: `HomeToolId`, `HomeRouteState`, `HomeTool`, `HomeSnapshot`, and registry helper names are used consistently across tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-pmc-home-command-center-phase-2.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.
