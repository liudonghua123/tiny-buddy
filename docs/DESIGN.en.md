# TinyBuddy UI Design Specification

> Scope: every screen in `apps/web`. Every number here comes from the code, not from a wish list —
> colours from `apps/web/src/styles.css`, type sizes and radii from actual usage frequency, contrast
> ratios computed with the WCAG 2.1 formula.
>
> Goal: with this document (plus `design-tokens.json`) you can build a page that **looks like it
> belongs to this product** without reading the component sources.

---

## 0. Quick start

1. Copy the `:root` / `.dark` variable blocks and the `@layer components` section from `apps/web/src/styles.css`.
2. Copy `theme.extend` from `apps/web/tailwind.config.js` as-is (colour, font, radius, shadow, animation).
3. Use one of the three page containers in §7 and only the classes from §6. **Never write raw colour values.**

Four hard rules — breaking any one of them immediately looks foreign:

| Rule | Why |
| --- | --- |
| Colours go through semantic tokens | No `bg-[#fff]`, no `text-gray-500`; only `bg-surface`, `text-muted`, … |
| Only two breakpoints | `sm` (640) and `lg` (1024). No `md` / `xl` / `2xl` |
| Controls 14px, containers 18px | `rounded-xl` / `rounded-2xl`; no 4/6/10px in between |
| Borders before shadows | A card is 1px `border-line` + `shadow-soft`; shadow only signals elevation |

---

## 1. Principles

**1.1 Mobile first, but not a blown-up phone layout.** Build for 390px first, then enhance with `sm:` /
`lg:`. The desktop sidebar is an increment; below `lg` everything collapses into
"title bar + four bottom tabs + a more sheet".

**1.2 Semantic colours, not semantic hex values.** The UI has eleven colour roles. Dark mode is not an
inversion — it reassigns the same roles, which is why components contain no `dark:` variants.

**1.3 One brand colour, strength by area.** Brand purple appears only on primary buttons, selected
states, brand icons, links and progress. Large areas use `brand-soft`, so a screen has exactly one
focal point.

**1.4 Dense, not cramped.** Body text is 12–13.5px, held together by a 0.5px type ramp and a 4px
spacing base. Card padding 16–20px, control gaps 8–12px, section gaps 20–28px.

**1.5 Progressive disclosure.** Tool calls, memory recalls and attachments collapse into one summary
line. The first screen answers "what happened"; details expand on demand.

---

## 2. Colour

### 2.1 Tokens

Values are `R G B` triples consumed through `rgb(var(--x) / <alpha-value>)`, so `bg-brand/10` and
`border-danger/25` work directly.

| Token | Role | Light | Dark | Typical use |
| --- | --- | --- | --- | --- |
| `bg` | canvas | `246 246 249` | `12 12 17` | page background, chat scroll area |
| `surface` | card | `255 255 255` | `20 20 27` | cards, inputs, modals, sidebar |
| `elevated` | raised | `255 255 255` | `25 25 33` | hover rows, tab track, code background |
| `line` | border | `233 233 240` | `38 38 47` | 1px borders, dividers, switch off state |
| `ink` | primary text | `23 23 29` | `236 236 242` | headings, body, button labels |
| `muted` | secondary text | `106 107 118` | `155 156 168` | descriptions, inactive nav |
| `faint` | tertiary text | `154 155 166` | `111 112 124` | timestamps, counts, placeholders |
| `brand` | accent | `109 74 255` | `139 109 255` | primary button, active icon, focus ring |
| `brand-soft` | accent surface | `240 236 255` | `33 26 61` | selected row, user bubble, icon tile |
| `brand-ink` | accent text | `75 47 208` | `196 181 255` | text on `brand-soft`, body links |
| `ok` | success | `31 157 114` | `62 207 154` | status dots, success icons |
| `warn` | warning | `194 117 31` | `226 164 90` | warning dots, quota hints |
| `danger` | danger | `209 73 91` | `242 112 127` | delete actions, errors |

### 2.2 Measured contrast (WCAG 2.1)

| Pair | Light | Dark | Verdict |
| --- | --- | --- | --- |
| `ink` / `surface` | 17.85 | 15.58 | AAA |
| `muted` / `surface` | 5.28 | 6.73 | AA body text |
| `brand-ink` / `brand-soft` | 6.94 | 8.91 | AAA, safe for selected states |
| `danger` / `surface` | 4.36 | 6.46 | Light is slightly under 4.5 — short text ≥13px only |
| `ok` / `surface` | 3.43 | 9.25 | Dots and icons only, never body text |
| `faint` / `surface` | **2.76** | 3.74 | Below AA — see constraints |
| white / `brand` | 5.15 | **3.67** | Dark mode: AA-Large only |

Two constraints that must hold:

- **`faint` never carries required information.** Timestamps, counts, placeholders, disabled icons
  only. Anything the user must read to finish a task uses `muted` at minimum.
- **Dark primary buttons** (white on `#8B6DFF` = 3.67) only at **≥14px semibold**; smaller labels
  should switch to `bg-brand-ink` with dark text, or use `btn-outline`.

### 2.3 Usage rules

| Situation | ✅ | ❌ |
| --- | --- | --- |
| Card elevation | `bg-surface` + `border-line` | `bg-white shadow-xl` |
| Highlight a block | `bg-brand-soft` + `text-brand-ink` | large `bg-brand` with white text |
| Destructive action | `btn-danger` (10% fill, 25% border) | solid red button |
| Divider | 1px `border-line` | grey shadow bar |
| Selected state | `bg-brand-soft text-brand-ink` + 6px dot | 3px left bar + bold |

---

## 3. Typography

### 3.1 Stacks

```css
font-family: -apple-system, BlinkMacSystemFont, Inter, "Segoe UI",
             "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
font-family-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
```

Latin faces come first and CJK faces fall back after them, so mixed zh/en text uses Inter/Segoe for
Latin and PingFang/YaHei for Chinese instead of handing the whole paragraph to a CJK font.

### 3.2 Scale

The real scale is a dense 0.5px ramp (9.5 → 34px), not the usual 12/14/16/20. It lets 10.5px metadata
and 11.5px hints sit on different levels — at the cost of having to pick **by semantics, not by feel**.

| Size | Role | Weight / leading | Where |
| --- | --- | --- | --- |
| 34px | marketing headline | 600 / 1.2 | login hero |
| 26px | page title | 600 / tight | `PageHeader` h1 (`sm`+) |
| 22px | page title (mobile) | 600 / tight | same, below `sm` |
| 16px | modal title | 600 | `Modal` header |
| 15px | emphatic body | 500–650 | markdown body, empty-state title, logo |
| 14.5px | chat bubble | 400 / relaxed | user message |
| 14px | large button | 500 | login submit `h-11` |
| 13.5px | nav, descriptions | 500 / relaxed | sidebar items, page subtitle, toast |
| 13px | control text | 500 | buttons, tabs, input values, card titles |
| 12.5px | secondary control | 400–500 | small buttons, inline links |
| 12px | label, author | 500 | `.label`, message author, badges |
| 11.5px | metadata | 400–500 | attachment names, hints, share validity |
| 11px | micro label | 500 | `.chip`, memory badge, tool status |
| 10.5px | tiny | 500 | bottom nav labels, logo tagline |
| 9.5–10px | decorative | 400–500 | counters, code copy button |

Rule: **within a level, adjacent steps differ by at most 1px; across levels by at least 2px** —
otherwise the hierarchy blurs.

### 3.3 Details

| Property | Value | Note |
| --- | --- | --- |
| Tracking | headings `-0.01em`; `.label` `wide` | tighten large sizes, loosen small caps |
| Uppercase labels | `.label` only | never uppercase Chinese |
| Numbers | `font-mono` for counts and durations | avoids width jitter |
| Body leading | 1.72 (`.md-body`) | CJK needs more room than Latin |
| Paragraph rhythm | `0.65em`, headings `1.1em` / `0.5em` | see `.md-body` |
| Wrapping | `word-break: break-word` | long URLs, CJK without spaces |

### 3.4 Markdown body (`.md-body`)

Shared by assistant answers, knowledge details and the share page — content typography, not UI
typography:

- 15px / 1.72; `h1 1.25em`, `h2 1.12em`, `h3 1.02em`, weight 650
- inline code: `0.86em`, 14% `faint` fill, 5px radius
- code blocks: **always dark** `#0f0f16` on `#e8e8f0`, 12px radius, 13px/1.6, horizontal scroll —
  keeps a terminal feel even in light mode
- quotes: 3px brand border at 55% + 5% brand fill
- tables: `display:block` with horizontal scroll, 7×10px cells, `bg-elevated` header
- links: `brand-ink`, underlined, `underline-offset: 2px`

---

## 4. Space, radius, elevation

### 4.1 Spacing (4px base)

| Relation | Value | Where |
| --- | --- | --- |
| icon ↔ text | 6–10px (`gap-1.5` … `gap-2.5`) | buttons, nav, chips |
| inside a control | 8–10px vertical, 12–14px horizontal | buttons, inputs |
| card padding | 16–20px (`p-4` / `p-5`) | cards, modal body |
| list item gap | 2–8px | nav, session list |
| section gap | 20–28px | header → content, form groups |
| page padding | 12–16px mobile, 24px desktop | all containers |

### 4.2 Radius

| Class | Value | Where |
| --- | --- | --- |
| `rounded-lg` | 8px | inline squares, tab inner, code copy |
| `rounded-xl` | **14px** | **all controls**: buttons, inputs, nav items, icon buttons, tool cards |
| `rounded-2xl` | **18px** | **all containers**: cards, bubbles, toasts, attachment cards |
| `rounded-3xl` | 24px | modals (top corners only on mobile) |
| `rounded-full` | 999 | chips, avatars, dots, switches, validity pills |

Mnemonic: **controls 14, containers 18, pills full**. User bubbles use
`rounded-2xl rounded-br-md` — the 6px corner points at the speaker.

### 4.3 Shadow

| Token | Value | Use |
| --- | --- | --- |
| `shadow-soft` | `0 1px 2px rgba(16,16,24,.04), 0 8px 24px -12px rgba(16,16,24,.12)` | cards, composer |
| `shadow-lift` | `0 2px 4px rgba(16,16,24,.04), 0 16px 40px -16px rgba(16,16,24,.2)` | modals, toasts, menus |

Shadow is only for elements that **float above the page**. Flat cards rely on their border; in dark
mode shadow is nearly invisible, so hierarchy comes from the `surface → elevated` lightness step
(which is exactly why dark `elevated` is five greys lighter than `surface`).

> Known inconsistency: `--shadow-color` is defined in both themes but `boxShadow` hard-codes
> `rgba(16,16,24,…)`. Making it `rgb(var(--shadow-color) / .12)` would be more correct; it is left
> as-is because dark mode should not lean on shadow anyway.

---

## 5. Motion

| Name | Value | Use |
| --- | --- | --- |
| `fade-up` | `.28s cubic-bezier(.2,.8,.2,1) both`, `translateY(6px)` → 0 | page enter, modal, toast, first paint of lists |
| `pulse-soft` | `1.4s ease-in-out infinite`, opacity 1 → .35 | typing caret, running state |
| `transition` | Tailwind default 150ms | hover, colour, border |
| `active:scale-[.98]` | 2% press scale | every button (built into `.btn`) |
| `animate-ping` | 1s infinite | `StatusDot` ok halo |

Motion explains state change, it does not perform. Entrances move no more than 6px; hover changes
colour or border only, never size; every clickable element has press feedback.

> Gap: no `prefers-reduced-motion` fallback yet. Recommended global patch:
> `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }`

---

## 6. Components

All component classes live in `@layer components`; pages compose semantic class names instead of
re-assembling utilities.

### 6.1 Buttons

| Class | Look | Use |
| --- | --- | --- |
| `.btn-primary` | brand fill, white label, `hover:brightness-110` | at most one per screen |
| `.btn-outline` | `surface` + `line` border + `ink` | secondary, cancel |
| `.btn-ghost` | transparent, `elevated` on hover | toolbars |
| `.btn-danger` | `danger/10` fill, `danger/25` border | delete, revoke |

Base `.btn`: `inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium`,
≈36px tall, `active:scale-[.98]`, `disabled:opacity-50 disabled:pointer-events-none`.
Size variants: default 36; login submit `h-11` (44); small `px-2.5 py-1.5 text-[11.5px]` (≈28) for
in-card actions only.

### 6.2 Icon button

`.icon-btn` = 36×36, `rounded-xl`, `text-muted`, `elevated` + `ink` on hover. Used in page headers,
modal close, locale/theme toggles.

> Touch target: 36px is the visual size; primary mobile actions (bottom nav, send) hit 40–48px.
> Nothing smaller than 36px is allowed.

### 6.3 Forms

```html
<label class="mb-3.5 block">
  <span class="label">Name</span>
  <input class="input" />
  <span class="mt-1 block text-[11.5px] leading-relaxed text-faint">Helper</span>
</label>
```

- `.input`: `rounded-xl border-line bg-surface px-3.5 py-2.5 text-sm`; focus = `border-brand/50` +
  `ring-4 ring-brand/10` (a ring, not an outline, so nothing shifts)
- `.label`: 12px / 500 / `uppercase tracking-wide` / `faint`, 6px below
- wrap with `Field` to keep label/hint spacing identical
- errors: `rounded-xl border-danger/25 bg-danger/10 px-3 py-2 text-[12.5px] text-danger` above the submit button

### 6.4 Card

`.card` = `rounded-2xl border border-line bg-surface shadow-soft`.
Variants: clickable adds `transition hover:border-faint/60 hover:bg-elevated/40`; emphasis uses
`border-brand/30 bg-brand-soft/40`; empty states use `border-dashed`.

### 6.5 Chips

`.chip` = 11px / 500 / `rounded-full` / `border-line` / `bg-elevated` / `text-muted`, 20px tall.
Semantic variants: brand (`border-brand/20 bg-brand-soft/60 text-brand-ink`), success
(`bg-ok/10 text-ok`), danger (`bg-danger/10 text-danger`). For "MCP", "enabled", "never expires".

### 6.6 Status and switch

- `StatusDot`: 8px dot, `ok / warn / danger / idle`; ok adds an `animate-ping` halo meaning "online"
- `Switch`: 38×22 pill, 16px knob, `bg-brand` on / `bg-line` off, 16px travel

### 6.7 Tabs

`inline-flex rounded-xl border border-line bg-elevated p-1` as the track; selected
`bg-surface text-ink shadow-sm`, unselected `text-muted hover:text-ink`; item `px-3.5 py-1.5 text-[13px]`
with an optional 11px `faint` counter.

### 6.8 Modal

- Layer `z-[80]`; backdrop `bg-black/40 backdrop-blur-[2px]`
- **Mobile rises from the bottom** (`items-end` + `rounded-t-3xl`), desktop centres
  (`sm:items-center` + `sm:rounded-3xl`)
- Width `sm:max-w-lg`, `wide` → `sm:max-w-2xl`; height capped at `90vh`, body scrolls independently
- Structure: header (16px title + close) / body (`px-5 pb-6 pt-4`) / footer
  (`border-t bg-elevated/60 px-5 py-3`, buttons right-aligned, `safe-bottom`)
- Behaviour: `Esc` closes, body scroll locked, backdrop click closes

### 6.9 Toast

Top centre on mobile, top right on desktop, `z-[100]`, max 3 at once.
`rounded-2xl border-line bg-surface/95 shadow-lift backdrop-blur`, 17px icon + 13.5px message.
Success/info 3.2s, error 5.2s, dismissible.

### 6.10 Empty state

`EmptyState`: dashed container + 48px brand-soft icon tile (`rounded-2xl`) + 15px title + 13px
description (`max-w-sm`) + optional action. 56px vertical padding, centred.

### 6.11 Page header

`PageHeader`: 22px (`sm` 26px) / 600 / `tracking-tight`; subtitle 13.5px `muted`, relaxed leading;
actions `shrink-0`; stacks vertically on small screens, spreads from `sm`. 20px bottom margin.

### 6.12 Navigation

| Area | Spec |
| --- | --- |
| Sidebar | **252px** wide, `bg-surface/60` + 1px right border; 20px logo padding; items 13.5px / 500, ≈34px tall, active `bg-brand-soft text-brand-ink` + 2.2 stroke icon + 6px dot |
| Top bar (mobile) | 48px (`sm` 56px), `bg-bg/90 backdrop-blur`, logo + page name left, locale/theme right |
| Bottom nav (mobile) | 4 primary entries + "More", 20px icons, 10.5px labels, active = 2×24px brand bar on top + bolder icon |
| More sheet | `MoreSheet` modal, 2-column grid, 12px padding + icon + 13px label |
| Drawer | 82% wide / max 320px, `animate-fade-up`, full nav + user card |

Nav is permission-filtered: `NAV_ITEMS` declares `permission`; entries the user cannot access are
**not rendered at all** (not greyed out).

### 6.13 Chat

| Element | Spec |
| --- | --- |
| User bubble | `bg-brand-soft`, `rounded-2xl rounded-br-md`, 14.5px / relaxed, right aligned, `max-w-[85%] sm:max-w-[75%]`, 16×10px padding |
| Assistant | **no bubble**, left aligned, 28px gradient avatar (`#8b6dff → #5b3ae0`, 9px radius) + 12px author + 15px body |
| Tool card | whole row clickable, `rounded-xl border-line`, 10.5px meta, 9px spinner or check; expanded shows input/output as 11px mono `pre` on `bg-elevated`, max height 10rem/14rem |
| Memory badge | 11px pill, `border-brand/20 bg-brand-soft/60 text-brand-ink`, expands to recalled snippets (11.5px) |
| Composer | `rounded-2xl border-line bg-surface shadow-soft`; focus `border-brand/40 ring-4 ring-brand/10`; pinned bottom with `bg-bg/80 backdrop-blur` + `safe-bottom` |
| Slash palette | absolutely positioned above the composer (`bottom-full`), `max-h-[320px]`, ↑↓/Enter/Esc |
| Message actions | copy / edit / regenerate, 24px tall, 11px text, visible on hover (always on touch) |

The chat column is **760px**, the narrowest container on the site — it keeps lines at 40–55 CJK
characters.

---

## 7. Layout and responsive behaviour

### 7.1 Breakpoints

| Breakpoint | Width | Form |
| --- | --- | --- |
| default | < 640px | single column; 48px top bar + bottom nav; modals become bottom sheets |
| `sm` | ≥ 640px | 24px page padding; centred modals; hover-revealed actions; two-column cards |
| `lg` | ≥ 1024px | 252px sidebar appears; top bar and bottom nav disappear |

No `md`/`xl`: in a chat-first product the intermediate widths have no real use case, and every extra
breakpoint is another layout to maintain.

### 7.2 Containers

| Page | Max width | Padding |
| --- | --- | --- |
| Chat `/chat` | `760px` | `px-3 py-4 sm:px-6 sm:py-6` |
| Share `/s/:token` | `860px` | `px-3 pb-16 sm:px-6` |
| Settings | `max-w-3xl` (768) | `px-4 py-5 sm:px-6 sm:py-7` |
| Audit / members / schedules | `max-w-4xl` (896) | same |
| Skills / knowledge / MCP / memory | `max-w-5xl` (1024) | same |
| Usage | `1100px` | same + `lg:pb-8` |

Rule of thumb: **long reading → narrow, lists → medium, charts and grids → wide.**

### 7.3 Shell

```
<div class="flex h-[100dvh] overflow-hidden">
  <Sidebar/>              // lg only, 252px
  <div class="flex flex-1 flex-col min-w-0">
      <MobileHeader/>     // below lg
      <main class="flex-1 min-h-0 overflow-hidden"><Outlet/></main>
      <BottomNav/>        // below lg
  </div>
</div>
```

- `h-[100dvh]`, not `h-screen`, to survive mobile browser chrome
- scrolling belongs to inner containers (`.scroll-thin`); the page itself never scrolls
- safe areas via `.safe-top` / `.safe-bottom` (`env(safe-area-inset-*)`)
- the chat page brings its own header; `Layout` skips the global top bar on `/chat` to avoid two titles

---

## 8. Dark mode

- `darkMode: "class"`, `.dark` on the root; three modes (light / dark / system) managed by `useTheme`
  and persisted in `localStorage.tb.theme`
- **Components never write `dark:`** — only token values change. The prefix survives in a handful of
  places that genuinely need inversion (e.g. code-block border)
- dark is not a naive inversion: `bg` is 12/12/17 (slightly warm, not pure black), `surface` 20/20/27,
  `elevated` 25/25/33 (each +5); `brand` brightens to `#8B6DFF`; `brand-soft` becomes deep purple
  `33 26 61`
- shadows barely register in dark; hierarchy is carried by lightness steps and 1px borders
- code blocks drop one more step (`#08080c`) plus a 1px border so they do not melt into the card

---

## 9. Accessibility

| Item | Current | Requirement |
| --- | --- | --- |
| Semantics | many clickable `div`s | clickable elements must be `button`/`a`, or carry `role` + keyboard handling |
| Focus visibility | inputs have a ring, **buttons do not** | add `:focus-visible { outline: 2px solid rgb(var(--brand)); outline-offset: 2px; }` |
| Keyboard | modal `Esc`, slash ↑↓/Enter/Esc | modals need focus trap and initial focus |
| Contrast | see §2.2 | no body text in `faint`; watch dark primary buttons |
| Hit area | 36px icon buttons | ≥ 40px for key mobile actions |
| Announcements | streaming text has no `aria-live` | add `aria-live="polite"` to the message region |
| Motion | no reduced-motion fallback | see the patch in §5 |

---

## 10. Internationalisation

- All copy goes through `t("namespace.key")`; **no Chinese literals inside components**
- Both languages share one type scale; English runs ~30% longer, so: buttons never get fixed widths
  (`whitespace-nowrap` + padding), label containers use `min-w-0` + `truncate`
- Chinese never gets `uppercase`; `.label`'s `tracking-wide` reads as slightly looser spacing, which is fine
- numbers, times and byte sizes go through `Intl` (`formatBytes` / `formatTime`), never string concat
- date groups (Today / Yesterday / Earlier) come from the locale pack, not hard-coded

---

## 11. Reuse checklist

Before shipping a new page:

- [ ] container picked from §7.2, `px-4` mobile → `sm:px-6` desktop
- [ ] header uses `PageHeader`, sizes untouched
- [ ] every colour is a semantic token — no `#hex`, no `gray-*`
- [ ] controls `rounded-xl`, containers `rounded-2xl`, no 4/6/10px in between
- [ ] one primary button per screen; destructive actions use `btn-danger`
- [ ] empty list → `EmptyState`, loading → `Spinner`, errors → Toast (never `alert`)
- [ ] permission-gated entries filtered with `can()`
- [ ] all copy in the locale pack, both languages
- [ ] no horizontal scroll at 390px (`scrollWidth === clientWidth`)
- [ ] walked through every screen in dark mode — no white cards floating on a dark canvas

Skeleton:

```tsx
export function XxxPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7">
      <PageHeader
        title={t("xxx.title")}
        subtitle={t("xxx.subtitle")}
        actions={<button className="btn-primary">{t("common.new")}</button>}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.id} className="card p-4 transition hover:border-faint/60">
            <div className="text-[13.5px] font-medium text-ink">{it.name}</div>
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{it.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 12. Appendix

| Item | Location |
| --- | --- |
| Tokens as JSON | [`design-tokens.json`](./design-tokens.json) |
| Visual style guide | [`styleguide.html`](./styleguide.html) (open in a browser, light/dark toggle) |
| CSS variables + component layer | `apps/web/src/styles.css` |
| Tailwind theme extension | `apps/web/tailwind.config.js` |
| Shared components | `apps/web/src/components/ui.tsx` |
| Navigation manifest | `apps/web/src/components/nav.ts` |
| Chat components | `apps/web/src/components/chat/` |
