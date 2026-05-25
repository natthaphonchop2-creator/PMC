# Home App Launcher Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved soft premium clinic Home App Launcher at `/` while preserving `/ads-agent`, `/page-automation`, and existing Settings behavior.

**Architecture:** Keep routing in `src/App.tsx` unchanged, but replace the Home page composition in `src/apps/home/HomeApp.tsx` with focused local components for the clinic image, launcher panel, app cards, and connection banner. Extend the existing Home tool registry/types to support eight launcher cards, then rewrite `src/apps/home/styles.css` around the slanted desktop panel and stacked mobile layout.

**Tech Stack:** React 19, TypeScript, Vite, `lucide-react`, CSS modules-by-file via `styles.css`, Vitest static render tests.

---

## File Structure

- Create: `public/pmc-clinic-reception.png`
  - Durable project asset copied from `/Users/natthaphon/Downloads/334dfdcd-2f5b-42c7-ad9e-6698d7fe3fa0.png`.
- Modify: `src/apps/home/types.ts`
  - Add `settings` and `reports` to `HomeToolId`.
  - Add `coming-soon` route state so disabled cards can distinguish setup from future modules.
  - Allow pastel icon tones needed by the new launcher cards.
- Modify: `src/apps/home/toolRegistry.ts`
  - Define the eight Home launcher cards with honest readiness states.
  - Keep `Ads Agent` and `Page Auto` route-enabled.
  - Add `Settings` as enabled but modal-driven through Home.
- Modify: `src/apps/home/api.ts`
  - Extend initial/composed tool state maps for eight tools.
  - Keep connection status conservative when APIs fail.
- Modify: `src/apps/home/HomeApp.tsx`
  - Replace current header/hero/apps/AI note with `HomeHeroMedia`, `HomeLauncherPanel`, `HomeAppCard`, and `HomeConnectionBanner`.
  - Preserve all Settings modal state, load, save, refresh, and Escape-close behavior.
- Replace: `src/apps/home/styles.css`
  - Implement the soft clinic shell, real image side, slanted panel, 4/2/1-column launcher grid, disabled card states, banner, and responsive rules.
  - Keep existing Settings modal class names functional.
- Modify: `tests/homeApp.test.tsx`
  - Update Home assertions for new copy, image asset, eight cards, disabled behavior, and responsive CSS markers.
  - Keep route regression tests for `/`, `/ads-agent`, and `/page-automation`.

## Task 1: Add Asset And Launcher Data Model

**Files:**
- Create: `public/pmc-clinic-reception.png`
- Modify: `src/apps/home/types.ts`
- Modify: `src/apps/home/toolRegistry.ts`
- Modify: `src/apps/home/api.ts`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Copy the clinic image into the project asset folder**

Run:

```bash
cp /Users/natthaphon/Downloads/334dfdcd-2f5b-42c7-ad9e-6698d7fe3fa0.png public/pmc-clinic-reception.png
file public/pmc-clinic-reception.png
```

Expected:

```text
public/pmc-clinic-reception.png: PNG image data, 1448 x 1086, 8-bit/color RGB, non-interlaced
```

- [ ] **Step 2: Write failing assertions for the new launcher inventory**

In `tests/homeApp.test.tsx`, update the first Home test body to this shape:

```tsx
  it('renders Home as a soft clinic app launcher with honest readiness states', () => {
    const html = renderToStaticMarkup(<HomeApp />)
    const text = visibleText(html)

    expect(html).toContain('class="home-clinic-media"')
    expect(html).toContain('src="/pmc-clinic-reception.png"')
    expect(html).toContain('ยินดีต้อนรับกลับ')
    expect(html).toContain('เลือก App เพื่อเริ่มงาน')
    expect(html).toContain('Smart Clinic Workspace')
    expect(html).toContain('ตั้งค่า API เพื่อให้ App แสดงข้อมูลจริง')
    expect(html).toContain('เปิด Settings')
    expect(html).toContain('Ads Agent')
    expect(html).toContain('Page Auto')
    expect(html).toContain('Settings')
    expect(html).toContain('CRM')
    expect(html).toContain('ERP')
    expect(html).toContain('Knowledge')
    expect(html).toContain('Website')
    expect(html).toContain('Reports')
    expect(countOccurrences(html, 'class="home-app-card')).toBe(8)
    expect(countOccurrences(html, 'href="/ads-agent"')).toBe(1)
    expect(countOccurrences(html, 'href="/page-automation"')).toBe(1)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('พร้อมใช้งาน')
    expect(html).toContain('รอตั้งค่า')
    expect(html).toContain('กำลังมา')
    expect(text).not.toContain('AI Priorities')
    expect(text).not.toContain('System Status')
    expect(text).not.toContain('command bar')
    expect(text).not.toContain('AI Brain')
    expect(text).not.toContain('PMC Master Agent')
    expect(text).not.toContain('source')
    expect(text).not.toContain('bridge')
  })
```

Update the route test expectations for Home from:

```tsx
      expect(html).toContain('ศูนย์รวม App')
```

to:

```tsx
      expect(html).toContain('Smart Clinic Workspace')
      expect(html).toContain('เลือก App เพื่อเริ่มงาน')
```

- [ ] **Step 3: Run the focused test to verify it fails**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because `pmc-clinic-reception.png`, `home-clinic-media`, `Page Auto`, `Settings`, `Reports`, and eight launcher card markup are not implemented yet.

- [ ] **Step 4: Extend the Home tool types**

Replace the top of `src/apps/home/types.ts` with:

```ts
export type HomeStatusState = 'loading' | 'connected' | 'ready' | 'setup' | 'unavailable'

export type HomeToolId = 'ads' | 'page' | 'settings' | 'crm' | 'erp' | 'knowledge' | 'website' | 'reports'

export type HomeRouteState = 'enabled' | 'modal' | 'setup' | 'coming-soon'
export type HomeIconTone = 'sand' | 'coral' | 'lavender' | 'blue' | 'green' | 'gold' | 'purple' | 'neutral'
export type HomeRisk = 'สูง' | 'ปานกลาง' | 'ต่ำ'
```

Then update the `HomeTool` type in the same file to:

```ts
export type HomeTool = {
  id: HomeToolId
  href: string
  iconTone: HomeIconTone
  routeState: HomeRouteState
  setupLabel?: string
  status: HomeStatusState
  statusText: string
  title: string
}
```

- [ ] **Step 5: Replace the launcher registry**

Replace `src/apps/home/toolRegistry.ts` with:

```ts
import type { HomeIconTone, HomeStatusState, HomeTool, HomeToolId } from './types'

type HomeToolDefinition = {
  id: HomeToolId
  href: string
  iconTone: HomeIconTone
  routeState: HomeTool['routeState']
  setupLabel?: string
  title: string
}

export const homeToolDefinitions: HomeToolDefinition[] = [
  { id: 'ads', href: '/ads-agent', iconTone: 'sand', routeState: 'enabled', title: 'Ads Agent' },
  { id: 'page', href: '/page-automation', iconTone: 'coral', routeState: 'enabled', title: 'Page Auto' },
  { id: 'settings', href: '#settings', iconTone: 'neutral', routeState: 'modal', title: 'Settings' },
  { id: 'crm', href: '#crm', iconTone: 'lavender', routeState: 'setup', setupLabel: 'ยังไม่ได้เชื่อมต่อระบบ CRM', title: 'CRM' },
  { id: 'erp', href: '#erp', iconTone: 'blue', routeState: 'coming-soon', setupLabel: 'กำลังเตรียมโมดูล ERP', title: 'ERP' },
  { id: 'knowledge', href: '#knowledge', iconTone: 'green', routeState: 'setup', setupLabel: 'รอตั้งค่าฐานความรู้', title: 'Knowledge' },
  { id: 'website', href: '#website-insight', iconTone: 'gold', routeState: 'coming-soon', setupLabel: 'กำลังเตรียมข้อมูลเว็บไซต์', title: 'Website' },
  { id: 'reports', href: '#reports', iconTone: 'purple', routeState: 'coming-soon', setupLabel: 'กำลังเตรียมรายงานรวม', title: 'Reports' },
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

- [ ] **Step 6: Extend Home snapshot tool state maps**

In `src/apps/home/api.ts`, replace `initialToolStateById` with:

```ts
const initialToolStateById = {
  ads: { state: 'loading', text: loadingStatus },
  page: { state: 'loading', text: loadingStatus },
  settings: { state: 'ready', text: 'พร้อมใช้งาน' },
  crm: { state: 'setup', text: 'รอตั้งค่า' },
  erp: { state: 'setup', text: 'กำลังมา' },
  knowledge: { state: 'setup', text: 'รอตั้งค่า' },
  website: { state: 'setup', text: 'กำลังมา' },
  reports: { state: 'setup', text: 'กำลังมา' },
} satisfies Record<HomeToolId, HomeToolState>
```

In `composeHomeSnapshot`, replace `toolStateById` with:

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
    settings: { state: 'ready' as const, text: 'พร้อมใช้งาน' },
    crm: { state: 'setup' as const, text: 'รอตั้งค่า' },
    erp: { state: 'setup' as const, text: 'กำลังมา' },
    knowledge: {
      state: knowledgeStatus.state,
      text: knowledgeStatus.value,
    },
    website: { state: 'setup' as const, text: 'กำลังมา' },
    reports: { state: 'setup' as const, text: 'กำลังมา' },
  } satisfies Record<HomeToolId, HomeToolState>
```

- [ ] **Step 7: Run typecheck through the focused test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: still FAIL because the Home JSX/CSS has not been redesigned yet, but TypeScript should not report missing `HomeToolId` cases.

- [ ] **Step 8: Commit the data model and test setup**

Run:

```bash
git add public/pmc-clinic-reception.png src/apps/home/types.ts src/apps/home/toolRegistry.ts src/apps/home/api.ts tests/homeApp.test.tsx
git commit -m "feat: prepare home launcher inventory"
```

Expected: commit succeeds with the asset, type, registry, API, and failing-home-test changes.

## Task 2: Rebuild Home Markup Around The Approved Launcher

**Files:**
- Modify: `src/apps/home/HomeApp.tsx`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Update imports for launcher icons**

In `src/apps/home/HomeApp.tsx`, replace the `lucide-react` import block with:

```tsx
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  Grid2X2,
  InfinityIcon,
  MessageCircle,
  Moon,
  Settings,
  UserRound,
  Users,
  X,
} from 'lucide-react'
```

- [ ] **Step 2: Update icon and description maps**

Replace `toolIcons`, `adsLogoSrc`, `pageAutoLogoSrc`, and `appDescriptions` with:

```tsx
const toolIcons: Record<HomeTool['id'], LucideIcon> = {
  ads: InfinityIcon,
  crm: Users,
  erp: Building2,
  knowledge: BookOpen,
  page: MessageCircle,
  reports: BarChart3,
  settings: Settings,
  website: Activity,
}

const clinicImageSrc = '/pmc-clinic-reception.png'
const adsLogoSrc = '/pmc-ads-logo.png?v=transparent'
const pageAutoLogoSrc = '/pmc-page-auto-logo.png?v=transparent'

const appDescriptions: Record<HomeTool['id'], string> = {
  ads: 'ดูโฆษณาและคำแนะนำที่รออนุมัติ',
  crm: 'ลูกค้าและงานติดตาม',
  erp: 'งานหลังบ้าน เอกสาร และสต็อก',
  knowledge: 'เอกสารและฐานความรู้สำหรับ AI',
  page: 'จัดการข้อความ เพจ และโพสต์',
  reports: 'สรุปผลและรายงาน',
  settings: 'ตั้งค่า Meta, AI และการเชื่อมต่อ',
  website: 'พฤติกรรมผู้ใช้งานเว็บไซต์',
}
```

- [ ] **Step 3: Replace the Home return markup**

In `HomeApp`, replace the returned JSX inside `return (` with:

```tsx
    <div className="home-shell">
      <main className="home-stage" aria-label="PMC App Launcher">
        <HomeHeroMedia />
        <HomeLauncherPanel
          isSettingsOpen={isSettingsOpen}
          onOpenSettings={() => void openSettings()}
          snapshot={snapshot}
        />
      </main>
      {isSettingsOpen ? (
        <HomeSettingsModal
          aiForm={aiForm}
          canSaveAi={canSaveAi}
          canSaveMeta={canSaveMeta}
          isLoading={isSettingsLoading}
          metaForm={metaForm}
          message={settingsMessage}
          onAiFormChange={setAiForm}
          onCheckAi={() => void checkAiSettings()}
          onClose={() => setIsSettingsOpen(false)}
          onMetaFormChange={setMetaForm}
          onRefresh={() => void loadSettings()}
          onSaveAi={() => void saveAiSettings()}
          onSaveMeta={() => void saveMetaSettings()}
          savingTarget={savingTarget}
          settings={settings}
        />
      ) : null}
    </div>
```

- [ ] **Step 4: Add Home layout components above `HomeSettingsModalProps`**

Insert this code before `type HomeSettingsModalProps`:

```tsx
function HomeHeroMedia() {
  return (
    <section className="home-clinic-media" aria-label="PMC Aesthetic Clinic">
      <img src={clinicImageSrc} alt="PMC Aesthetic Clinic reception" />
      <div className="home-clinic-copy">
        <strong>Smart Clinic Workspace</strong>
        <p>ศูนย์รวม App สำหรับทีม PMC เพื่อเริ่มงานจากระบบที่ต้องใช้จริงในแต่ละวัน</p>
      </div>
    </section>
  )
}

function HomeLauncherPanel({
  isSettingsOpen,
  onOpenSettings,
  snapshot,
}: {
  isSettingsOpen: boolean
  onOpenSettings: () => void
  snapshot: HomeSnapshot
}) {
  return (
    <section className="home-launcher-panel" aria-label="เลือก App เพื่อเริ่มงาน">
      <div className="home-launcher-inner">
        <div className="home-top-controls">
          <button className="home-round-button" type="button" aria-label="เปลี่ยนธีม">
            <Moon size={18} />
          </button>
          <button
            className="home-user-pill"
            type="button"
            aria-expanded={isSettingsOpen}
            aria-haspopup="dialog"
            onClick={onOpenSettings}
          >
            <span className="home-user-avatar">
              <UserRound size={17} />
            </span>
            <span>
              <small>Signed in as</small>
              <strong>PMC Team</strong>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="home-launcher-heading">
          <h1>ยินดีต้อนรับกลับ</h1>
          <p>เลือก App เพื่อเริ่มงาน</p>
        </div>

        <div className="home-app-grid">
          {snapshot.tools.map((tool) => (
            <AppCard key={tool.id} onOpenSettings={onOpenSettings} tool={tool} />
          ))}
        </div>

        <HomeConnectionBanner onOpenSettings={onOpenSettings} snapshot={snapshot} />

        <footer className="home-footer">
          <span>© 2026 PMC Aesthetic Clinic</span>
          <span>Help Center · Privacy · Terms</span>
        </footer>
      </div>
    </section>
  )
}

function HomeConnectionBanner({ onOpenSettings, snapshot }: { onOpenSettings: () => void; snapshot: HomeSnapshot }) {
  const needsSetup = snapshot.headerStatuses.some((status) => status.state === 'setup' || status.state === 'unavailable' || status.state === 'loading')

  return (
    <section className="home-connection-banner" aria-label="ตั้งค่าการเชื่อมต่อ">
      <span className="home-banner-mark">
        <Settings size={18} />
      </span>
      <span>
        <strong>{needsSetup ? 'ตั้งค่า API เพื่อให้ App แสดงข้อมูลจริง' : 'ระบบหลักพร้อมใช้งาน'}</strong>
        <small>Meta และ AI ใช้ร่วมกับ Ads Agent และ Page Auto</small>
      </span>
      <button type="button" onClick={onOpenSettings}>
        เปิด Settings
        <ChevronRight size={15} />
      </button>
    </section>
  )
}
```

- [ ] **Step 5: Replace `AppCard` with modal-aware launcher card behavior**

Replace the existing `AppCard` function with:

```tsx
function AppCard({ onOpenSettings, tool }: { onOpenSettings: () => void; tool: HomeTool }) {
  const Icon = toolIcons[tool.id] ?? Grid2X2
  const disabled = tool.routeState === 'setup' || tool.routeState === 'coming-soon'
  const content = (
    <>
      <span className={`home-app-icon ${tool.iconTone}`}>
        {tool.id === 'ads' ? <ProductLogo alt="PMC Ads" src={adsLogoSrc} /> : null}
        {tool.id === 'page' ? <ProductLogo alt="PMC Page Auto" src={pageAutoLogoSrc} /> : null}
        {tool.id !== 'ads' && tool.id !== 'page' ? <Icon size={25} /> : null}
      </span>
      <span className="home-app-copy">
        <strong>{tool.title}</strong>
        <span>{appDescriptions[tool.id]}</span>
        <em className={`home-app-status ${statusStateClass(tool.status)}`}>{tool.statusText}</em>
        {tool.setupLabel ? <small>{tool.setupLabel}</small> : null}
      </span>
      <b className="home-app-arrow" aria-hidden="true">
        <ChevronRight size={16} />
      </b>
    </>
  )

  if (tool.routeState === 'modal') {
    return (
      <button className="home-app-card" type="button" onClick={onOpenSettings}>
        {content}
      </button>
    )
  }

  if (disabled) {
    return (
      <div className="home-app-card is-disabled" role="group" aria-disabled="true" aria-label={`${tool.title}: ${tool.statusText}`}>
        {content}
      </div>
    )
  }

  return (
    <a className="home-app-card" href={tool.href}>
      {content}
    </a>
  )
}
```

- [ ] **Step 6: Delete retired suggestion rendering**

Delete `SuggestionCard` and `renderPriorityIcon` from `src/apps/home/HomeApp.tsx`. Keep `ProductLogo` and `statusStateClass`.

Confirm the top import block does not include `FileText` or `Sparkles`.

- [ ] **Step 7: Run the focused test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: CSS-related tests may still fail because slanted/mobile class rules are not written yet. Markup assertions from Task 1 should now pass.

- [ ] **Step 8: Commit Home markup**

Run:

```bash
git add src/apps/home/HomeApp.tsx tests/homeApp.test.tsx
git commit -m "feat: rebuild home launcher markup"
```

Expected: commit succeeds with Home JSX and test updates.

## Task 3: Replace Home Styling With Soft Slanted Launcher

**Files:**
- Replace: `src/apps/home/styles.css`
- Test: `tests/homeApp.test.tsx`

- [ ] **Step 1: Update CSS-specific tests before writing CSS**

In `tests/homeApp.test.tsx`, replace the test named `has dedicated compact Home rules for tablet, phone, and narrow phone widths` with:

```tsx
  it('has responsive Home rules for slanted desktop panel and stacked mobile layout', () => {
    const homeCss = readText('../src/apps/home/styles.css')

    expect(homeCss).toContain('.home-stage')
    expect(homeCss).toContain('.home-clinic-media')
    expect(homeCss).toContain('.home-launcher-panel')
    expect(homeCss).toContain('clip-path: polygon(12% 0, 100% 0, 100% 100%, 0 100%)')
    expect(homeCss).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(homeCss).toContain('@media (max-width: 1120px)')
    expect(homeCss).toContain('clip-path: none')
    expect(homeCss).toContain('@media (max-width: 760px)')
    expect(homeCss).toContain('@media (max-width: 480px)')
    expect(homeCss).toContain('overflow-wrap: anywhere')
    expect(homeCss).not.toContain('radial-gradient(circle at 15% 0%')
    expect(homeCss).not.toContain('home-ai-note')
  })
```

- [ ] **Step 2: Run the CSS test to verify it fails**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: FAIL because `styles.css` still contains the old gradient home and lacks slanted panel rules.

- [ ] **Step 3: Replace the non-modal Home CSS**

In `src/apps/home/styles.css`, keep the existing Settings modal block from `.home-settings-backdrop` through `.home-settings-foot p` unchanged. Delete every rule before `.home-settings-backdrop`, delete the old responsive rules after `.home-settings-foot p`, then insert this CSS before `.home-settings-backdrop`:

```css
.home-shell {
  --home-ink: #141414;
  --home-muted: #69707d;
  --home-subtle: #9ca3af;
  --home-border: #e6e0d8;
  --home-border-cool: #e4e7ec;
  --home-panel: rgba(255, 255, 255, 0.95);
  --home-warm: #fbfaf8;
  --home-taupe: #aa8358;
  --home-green: #167047;
  --home-orange: #b7791f;
  --home-red: #c2414b;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: linear-gradient(135deg, #fbfaf8 0%, #f4eee6 52%, #ffffff 100%);
  color: var(--home-ink);
  overflow-x: hidden;
}

.home-shell *,
.home-shell *::before,
.home-shell *::after {
  box-sizing: border-box;
}

.home-shell a {
  color: inherit;
  text-decoration: none;
}

.home-stage {
  width: min(100%, 1500px);
  min-height: min(900px, calc(100vh - 48px));
  position: relative;
  overflow: hidden;
  border: 1px solid var(--home-border);
  border-radius: 22px;
  background: #f8f4ed;
  box-shadow: 0 24px 70px rgba(61, 46, 31, 0.14);
}

.home-clinic-media {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.home-clinic-media img {
  width: 48%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: 40% center;
}

.home-clinic-media::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0));
  pointer-events: none;
}

.home-clinic-copy {
  width: min(330px, 30vw);
  position: absolute;
  left: 50px;
  bottom: 58px;
  color: #111827;
}

.home-clinic-copy strong,
.home-clinic-copy p,
.home-launcher-heading h1,
.home-launcher-heading p,
.home-app-copy strong,
.home-app-copy span,
.home-app-copy small,
.home-connection-banner strong,
.home-connection-banner small,
.home-footer span,
.home-user-pill strong,
.home-user-pill small,
.home-settings-head p,
.home-settings-head h2,
.home-settings-head span,
.home-settings-status-line strong,
.home-settings-status-line span,
.home-settings-card-head strong,
.home-settings-card-head span,
.home-settings-card label,
.home-settings-card input,
.home-settings-foot p {
  min-width: 0;
  overflow-wrap: anywhere;
}

.home-clinic-copy strong {
  display: block;
  font-size: 30px;
  font-weight: 950;
  line-height: 1.1;
}

.home-clinic-copy p {
  margin: 14px 0 0;
  color: #4b5563;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.55;
}

.home-launcher-panel {
  width: 72%;
  min-width: 760px;
  min-height: 100%;
  position: absolute;
  inset: 0 0 0 auto;
  background: var(--home-panel);
  clip-path: polygon(12% 0, 100% 0, 100% 100%, 0 100%);
  box-shadow: -30px 0 72px rgba(64, 45, 28, 0.1);
}

.home-launcher-inner {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 34px 38px 24px 150px;
}

.home-top-controls {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 44px;
}

.home-round-button,
.home-user-pill,
.home-app-card,
.home-connection-banner button,
.home-settings-close,
.home-settings-primary,
.home-settings-secondary {
  font: inherit;
  letter-spacing: 0;
}

.home-round-button {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border: 1px solid var(--home-border-cool);
  border-radius: 50%;
  background: #fff;
  color: #475467;
  cursor: pointer;
}

.home-user-pill {
  min-width: 188px;
  min-height: 46px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 9px;
  padding: 0 15px 0 8px;
  border: 1px solid var(--home-border-cool);
  border-radius: 999px;
  background: #fff;
  color: var(--home-ink);
  cursor: pointer;
}

.home-user-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f0f1f3;
  color: #667085;
}

.home-user-pill small,
.home-user-pill strong {
  display: block;
  line-height: 1.1;
}

.home-user-pill small {
  color: #9ca3af;
  font-size: 10px;
  font-weight: 760;
}

.home-user-pill strong {
  margin-top: 3px;
  color: #111827;
  font-size: 12px;
  font-weight: 900;
}

.home-launcher-heading {
  margin-bottom: 30px;
}

.home-launcher-heading h1 {
  margin: 0;
  color: #111827;
  font-size: clamp(30px, 3vw, 38px);
  font-weight: 950;
  line-height: 1.05;
}

.home-launcher-heading p {
  margin: 10px 0 0;
  color: #737373;
  font-size: 18px;
  font-weight: 680;
}

.home-app-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.home-app-card {
  min-height: 154px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 19px 18px 16px;
  border: 1px solid #e6e8ed;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.97);
  color: inherit;
  text-align: left;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.055);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

button.home-app-card {
  cursor: pointer;
}

a.home-app-card:hover,
button.home-app-card:hover {
  transform: translateY(-2px);
  border-color: #d8c8b6;
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.08);
}

.home-app-card:focus-visible,
.home-round-button:focus-visible,
.home-user-pill:focus-visible,
.home-connection-banner button:focus-visible,
.home-settings-close:focus-visible,
.home-settings-primary:focus-visible,
.home-settings-secondary:focus-visible,
.home-settings-card input:focus-visible {
  outline: 3px solid rgba(170, 131, 88, 0.28);
  outline-offset: 3px;
}

.home-app-card.is-disabled {
  opacity: 0.66;
}

.home-app-icon {
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  margin-bottom: 22px;
  border-radius: 14px;
  color: #475467;
}

.home-app-icon.sand { background: #f2eadf; color: #8a653a; }
.home-app-icon.coral { background: #ffe7e3; color: #d65f4d; }
.home-app-icon.neutral { background: #eceff3; color: #667085; }
.home-app-icon.lavender { background: #e9e6ff; color: #7664d8; }
.home-app-icon.blue { background: #e6f0fb; color: #2f86eb; }
.home-app-icon.green { background: #e8f7ed; color: #167047; }
.home-app-icon.gold { background: #fff0d2; color: #b7791f; }
.home-app-icon.purple { background: #f3e6ff; color: #8f5ad8; }

.home-product-logo {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  object-fit: contain;
}

.home-app-copy {
  display: grid;
  gap: 7px;
}

.home-app-copy strong {
  color: #151515;
  font-size: 16px;
  font-weight: 950;
  line-height: 1.15;
}

.home-app-copy span {
  color: #6b7280;
  font-size: 12px;
  font-weight: 720;
  line-height: 1.4;
}

.home-app-copy small {
  color: #7a8493;
  font-size: 11px;
  font-weight: 760;
  line-height: 1.35;
}

.home-app-status {
  width: fit-content;
  display: inline-block;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
  font-style: normal;
  font-weight: 900;
  line-height: 1;
}

.home-app-status.good {
  background: #edf7f1;
  color: var(--home-green);
}

.home-app-status.watch {
  background: #fff6df;
  color: var(--home-orange);
}

.home-app-status.critical {
  background: #fff0f1;
  color: var(--home-red);
}

.home-app-arrow {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  margin-top: auto;
  margin-left: auto;
  border: 1px solid #e3e6eb;
  border-radius: 50%;
  color: var(--home-taupe);
}

.home-app-card.is-disabled .home-app-arrow {
  color: #98a2b3;
}

.home-connection-banner {
  min-height: 70px;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin-top: 24px;
  padding: 14px 16px;
  border: 1px solid #ede6dd;
  border-radius: 12px;
  background: rgba(250, 247, 242, 0.94);
}

.home-banner-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e4dbcf;
  color: #8a653a;
}

.home-connection-banner strong,
.home-connection-banner small {
  display: block;
}

.home-connection-banner strong {
  color: #111827;
  font-size: 13px;
  font-weight: 950;
}

.home-connection-banner small {
  margin-top: 4px;
  color: #667085;
  font-size: 12px;
  font-weight: 720;
}

.home-connection-banner button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: var(--home-taupe);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 950;
}

.home-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding-top: 20px;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
}
```

After this step, `.home-settings-backdrop`, `.home-settings-modal`, `.home-settings-close`, `.home-settings-head`, `.home-settings-status`, `.home-settings-card`, `.home-settings-actions`, `.home-settings-primary`, `.home-settings-secondary`, and `.home-settings-foot` rules should still exist in `src/apps/home/styles.css`.

- [ ] **Step 4: Add responsive rules after Settings modal styles**

Add these responsive rules at the bottom of `src/apps/home/styles.css`:

```css
@media (max-width: 1120px) {
  .home-shell {
    display: block;
    padding: 18px;
  }

  .home-stage {
    min-height: 0;
  }

  .home-clinic-media {
    position: relative;
    min-height: 340px;
  }

  .home-clinic-media img {
    width: 100%;
    height: 340px;
    object-position: center 42%;
  }

  .home-clinic-copy {
    width: min(420px, calc(100% - 48px));
    left: 32px;
    bottom: 32px;
  }

  .home-launcher-panel {
    width: 100%;
    min-width: 0;
    position: relative;
    clip-path: none;
  }

  .home-launcher-inner {
    padding: 32px;
  }

  .home-app-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .home-shell {
    padding: 12px;
  }

  .home-stage {
    border-radius: 18px;
  }

  .home-clinic-media,
  .home-clinic-media img {
    min-height: 280px;
    height: 280px;
  }

  .home-clinic-copy {
    left: 24px;
    right: 24px;
    bottom: 24px;
  }

  .home-clinic-copy strong {
    font-size: 25px;
  }

  .home-launcher-inner {
    padding: 26px 22px 22px;
  }

  .home-top-controls {
    justify-content: space-between;
    margin-bottom: 28px;
  }

  .home-user-pill {
    min-width: 0;
  }

  .home-launcher-heading h1 {
    font-size: 30px;
  }

  .home-launcher-heading p {
    font-size: 16px;
  }

  .home-connection-banner {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .home-connection-banner button {
    grid-column: 1 / -1;
    width: 100%;
  }

  .home-footer {
    display: grid;
  }

  .home-settings-status,
  .home-settings-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 480px) {
  .home-app-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .home-clinic-media,
  .home-clinic-media img {
    min-height: 240px;
    height: 240px;
  }

  .home-app-card {
    min-height: 0;
  }

  .home-settings-backdrop {
    align-items: start;
    padding: 14px;
  }

  .home-settings-modal {
    max-height: calc(100vh - 28px);
    padding: 22px;
    border-radius: 20px;
  }

  .home-settings-head {
    grid-template-columns: minmax(0, 1fr);
    padding-right: 38px;
  }

  .home-settings-status-line {
    grid-template-columns: 12px minmax(0, 1fr);
  }

  .home-settings-status-line span:last-child {
    grid-column: 2;
    justify-self: start;
    text-align: left;
  }

  .home-settings-actions,
  .home-settings-foot,
  .home-settings-foot > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS for Home tests, unless old assertions elsewhere in the file still expect retired Home copy/classes. Update only those stale assertions to the new Home spec.

- [ ] **Step 6: Commit Home styling**

Run:

```bash
git add src/apps/home/styles.css tests/homeApp.test.tsx
git commit -m "feat: style home app launcher"
```

Expected: commit succeeds with CSS and test updates.

## Task 4: Final Verification And Browser QA

**Files:**
- Modify only if verification exposes a specific defect.

- [ ] **Step 1: Run focused Home tests**

Run:

```bash
npm run test -- tests/homeApp.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run existing Page Automation route tests that protect sibling app behavior**

Run:

```bash
npm run test -- tests/page-automation/autoPostRoute.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no unused imports in `HomeApp.tsx`.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS for client and server builds.

- [ ] **Step 5: Start local dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite starts and prints a local URL, usually `http://127.0.0.1:5173/`. If that port is occupied, use the next printed port.

- [ ] **Step 6: Browser QA desktop**

Open `/` in the browser at the Vite URL.

Verify:

- Clinic image is visible on the left.
- White launcher panel has a slanted left edge.
- Cards are in a 4-column grid.
- Cards show `Ads Agent`, `Page Auto`, `Settings`, `CRM`, `ERP`, `Knowledge`, `Website`, `Reports`.
- `Ads Agent` card opens `/ads-agent`.
- `Page Auto` card opens `/page-automation`.
- `Settings` opens the existing settings modal.
- Disabled cards do not navigate to fake routes.

- [ ] **Step 7: Browser QA mobile**

Use browser responsive mode around 390px width.

Verify:

- Image stacks above launcher panel.
- Slanted edge is removed.
- No horizontal overflow.
- Card text fits.
- Settings modal opens and can close with Escape.

- [ ] **Step 8: Fix any QA defects with a focused commit**

If QA exposes a defect, edit only the necessary file and run:

```bash
npm run test -- tests/homeApp.test.tsx
npm run lint
npm run build
```

Expected: all PASS.

Commit:

```bash
git add src/apps/home/HomeApp.tsx src/apps/home/styles.css tests/homeApp.test.tsx
git commit -m "fix: polish home launcher responsive qa"
```

Only run this commit step if files changed during QA.

## Self-Review

- Spec coverage: Home-only scope, real asset, slanted desktop panel, stacked mobile, eight launcher cards, Settings modal preservation, disabled-card honesty, and route regression are each covered by tasks.
- Placeholder scan: no `TBD`, `TODO`, or "implement later" steps remain.
- Type consistency: `HomeToolId`, `HomeRouteState`, `HomeIconTone`, `HomeTool`, and `AppCard` usage are defined before later tasks use them.
- Risk control: work is split into data model, markup, styling, and verification commits so regressions are easy to isolate.
