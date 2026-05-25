# Home App Launcher Redesign Design

Date: 2026-05-26
Status: Approved for implementation planning
Selected approach: Home-first, lightweight design system
Visual reference: soft premium clinic split screen with a slanted white launcher panel

## Goal

Redesign `/` into a premium but practical PMC App Launcher. The page should help users open the right PMC app quickly, clearly show which modules are ready, and establish the visual language that later phases can bring into Ads Agent and Page Automation.

This phase does not redesign `/ads-agent` or `/page-automation`. It creates the first production-quality Home surface and the minimal reusable styling patterns needed by Home.

## Product Boundary

Routes:

- `/` renders the new Home App Launcher.
- `/ads-agent` keeps the existing Ads Agent application.
- `/page-automation` keeps the existing Page Automation application.

Home v1 is an app launcher, not a command center. It does not include a command bar, centralized AI action dispatcher, or priority-first wall.

## Visual Direction

Use the approved reference direction:

- Left side: real clinic image as the primary brand signal.
- Right side: soft white launcher panel.
- Desktop/tablet: the launcher panel overlaps the image with a slanted left edge.
- Mobile: remove the slanted edge and stack the image above the launcher to avoid overflow.
- Overall tone: soft premium clinic, white surfaces, warm neutral background, subtle taupe/gold accent, pastel app icon blocks, low-noise shadows.

Do not let the palette become a heavy beige theme. The app area should still feel like a work tool.

## Image Asset

Use the clinic image supplied by the user:

- Source path: `/Users/natthaphon/Downloads/334dfdcd-2f5b-42c7-ad9e-6698d7fe3fa0.png`
- Source dimensions: 1448 x 1086

Implementation should copy this into a durable project asset path, such as `public/pmc-clinic-reception.png`, rather than loading from `Downloads`.

Crop rules:

- Desktop: background image should cover the left side and show both the PMC wall logo and reception area.
- The panel slant may cover part of the right side of the image.
- Keep the image bright and soft; avoid dark overlays.
- Mobile: crop around the logo/reception with enough height to preserve the brand signal.

## Layout

Desktop:

- Full-page framed shell with soft background.
- Left image region around 35-40% of the width.
- Right panel around 65-72% of the width, overlapping the image.
- Launcher panel left edge is slanted.
- App grid uses 4 columns.
- A compact settings/user/status control row sits at the top right of the panel.
- Main heading: `ยินดีต้อนรับกลับ`
- Subtitle: `เลือก App เพื่อเริ่มงาน`

Tablet:

- Preserve the split feel if enough width exists.
- App grid can reduce to 2 columns.
- Slant is allowed only when text/card width remains comfortable.

Mobile:

- Stack image first, launcher second.
- Remove the slanted panel shape.
- Use 1 or 2 card columns based on available width.
- No horizontal overflow.

## Launcher Apps

Home v1 shows eight launcher cards so the surface feels like a complete platform while remaining honest about readiness.

Ready cards:

- `Ads Agent` -> `/ads-agent`
- `Page Auto` -> `/page-automation`
- `Settings` -> opens the existing settings modal

Not-ready cards:

- `CRM` -> disabled/setup-needed card
- `ERP` -> disabled/coming-soon card
- `Knowledge` -> disabled/setup-needed card
- `Website` -> disabled/coming-soon card
- `Reports` -> disabled/coming-soon card

Disabled cards must not route to fake dashboards.

## Components

Prefer focused Home components rather than growing one large file.

Suggested boundaries:

- `HomeHeroMedia`: renders the clinic image and short overlay copy.
- `HomeLauncherPanel`: renders the top controls, heading, grid, banner, and footer.
- `HomeAppCard`: renders each app tile with icon, title, description, status badge, and arrow affordance.
- `HomeConnectionBanner`: prompts the user to open Settings when Meta or AI setup is needed.
- `HomeSettingsModal`: preserve existing settings behavior and API calls.

The implementation can keep these in `src/apps/home/HomeApp.tsx` initially if the file stays readable, but extracted components are preferred if the JSX grows.

## Copy

Use user-facing Thai labels.

Approved labels:

- `ยินดีต้อนรับกลับ`
- `เลือก App เพื่อเริ่มงาน`
- `พร้อมใช้งาน`
- `รอตั้งค่า`
- `กำลังมา`
- `ตั้งค่า API เพื่อให้ App แสดงข้อมูลจริง`
- `Meta และ AI ใช้ร่วมกับ Ads Agent และ Page Auto`
- `เปิด Settings`

Avoid internal/system wording in visible UI:

- `AI Brain`
- `PMC Master Agent`
- `source`
- `bridge`
- `dispatcher`
- raw API error names as primary copy

## Behavior

- Clicking `Ads Agent` navigates to `/ads-agent`.
- Clicking `Page Auto` navigates to `/page-automation`.
- Clicking `Settings` opens the current settings modal.
- Clicking disabled cards should either do nothing beyond a clear disabled state or show a light setup/coming-soon explanation. It must not navigate to an unimplemented route.
- The connection banner should guide users to Settings when Meta or AI configuration is missing.
- If connection data fails to load, Home should not invent a connected state.

## Data And State Rules

Use the existing Home settings/status logic where practical:

- Meta status comes from current Home status/settings APIs.
- AI status comes from current Home status/settings APIs.
- Saved credentials must remain local and must not be printed to the UI.
- Existing save/check behavior for Meta and AI settings must continue to work.

States:

- Loading: show stable layout and light loading/skeleton treatment for status values.
- API ready: show ready/connected status in the relevant top controls or banner.
- API missing: show setup-needed language and a Settings action.
- API error: show user-facing recovery copy.
- Disabled app: show `รอตั้งค่า` or `กำลังมา`.

## Visual System Rules

- Use `lucide-react` icons for implementation, not emoji.
- Card radius can be around 10-12px for Home launcher cards.
- Use subtle shadows and borders; avoid floating card stacks inside other cards.
- Use pastel icon blocks per app for recognition.
- Text must fit within cards in Thai and English.
- No decorative gradient orbs or bokeh backgrounds.
- Keep letter spacing at 0 except brand text that already exists in the image.

## Accessibility

- Launcher cards that navigate should be anchors or buttons with clear accessible labels.
- Disabled cards should expose disabled state without pretending to be active links.
- Settings modal must remain keyboard accessible and closable with Escape.
- Color must not be the only status signal; include text badges.
- Focus states should remain visible on cards, buttons, and modal controls.

## Testing

Automated checks:

- `/` renders the redesigned Home App Launcher.
- `/ads-agent` still renders the Ads Agent app.
- `/page-automation` still renders the Page Automation app.
- `Ads Agent` and `Page Auto` cards route to the correct paths.
- `Settings` opens the existing settings modal.
- Disabled cards do not navigate to fake routes.
- Meta/AI status rendering does not show connected/ready when APIs fail.

Run:

- `npm run test -- tests/homeApp.test.tsx`
- `npm run lint`
- `npm run build`

Manual/browser QA:

- Desktop viewport: verify slanted panel, image crop, card grid, and no overlap.
- Tablet viewport: verify card columns and readable panel width.
- Mobile viewport: verify stacked layout, no slant, no horizontal overflow.
- Verify Settings save/check flows still work when local API is available.

## Rollout Plan

Phase 1 implements only the Home App Launcher.

Later phases can reuse the visual language in this order:

1. Page Automation header/shell and route cards.
2. Ads Agent dashboard shell and cards.
3. Broader shared tokens/components if repeated patterns justify extraction.

## Self-Review

- No command bar remains in scope.
- Home is the first implementation target; other apps are deferred.
- Ready and not-ready app states are explicit.
- The real image asset has a durable implementation path.
- Mobile behavior removes the slant to prevent overflow.
