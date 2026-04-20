# woofx3 — Design guidelines

## Design Approach

**Hybrid Approach**: Blend production control interface patterns (Premiere Pro, OBS Studio) with modern dashboard design (Twitch Creator Dashboard, n8n.io workflow builder) and streaming tools (Firebot, streamer.bot). Focus on professional broadcast control aesthetics with emphasis on information density, quick access, and spatial organization.

**Core Design Principle**: "Professional Control Plane" - Interface should feel like a mission control center for live streaming, balancing power-user efficiency with approachable simplicity for beginners.

## Layout System

**Primary Layout Pattern**: Persistent sidebar navigation + main content area + contextual right panel (inspector/properties)

**Spacing Scale**: Use Tailwind units of 1, 2, 3, 4, 6, 8, 12 for consistent rhythm
- Component padding: p-4 to p-6
- Section gaps: gap-6 to gap-8
- Page margins: p-8 to p-12
- Tight groupings: gap-2 to gap-3

**Grid System**: 
- Dashboard cards: 12-column grid with 2-4 column spans
- Module browser: 3-4 column masonry grid
- Asset grid: 4-6 columns with equal heights
- Workflow canvas: Infinite pan/zoom canvas (no grid constraints)

## Typography

**Font Families**:
- Interface: Inter or SF Pro (clean, professional, excellent at small sizes)
- Monospace: JetBrains Mono (for technical details, IDs, code snippets)

**Type Scale**:
- Page titles: text-2xl to text-3xl, font-semibold
- Section headers: text-lg to text-xl, font-medium
- Card titles: text-base, font-medium
- Body text: text-sm
- Labels/metadata: text-xs
- Technical details: text-xs, font-mono

## Navigation & Menu System

**Sidebar Navigation** (280-320px width, collapsible to 64px icon-only):
- Top section: Team/Account switcher with avatar + dropdown
- Middle section: Primary navigation with expandable submenus (2-3 levels deep)
- Bottom section: User profile, settings, theme toggle
- Visual style: Subtle dividers, active state emphasis, icon + label pairing
- Submenu behavior: Expand/collapse animation, indent each level by 12px
- Hover states: Slight background shift, not full-width highlighting

**Top Bar** (56-64px height):
- Breadcrumb navigation showing current context
- Quick actions toolbar (rightmost): Save, Publish, Preview buttons
- Global search with cmd+k trigger
- Notification bell with unread badge

## Component Library

**Cards**:
- Module cards: 16:9 aspect ratio preview + title + metadata + action buttons
- Workflow nodes: Compact rounded rectangles with input/output ports, icon, and label
- Asset thumbnails: Square with overlay controls on hover
- Stat cards: Minimal borders, clear hierarchy of number (large) vs label (small)

**Panels**:
- Inspector panel (right side, 320-400px): Properties editor with collapsible sections using accordions
- Event configuration: Form-based with sections for different parameter groups
- Asset uploader: Drag-drop zone with progress bars and preview queue

**Data Tables**:
- Striped rows for better scanning
- Sticky header row
- Row actions appear on hover (right-aligned)
- Virtual scrolling for 100+ items
- Sortable columns with clear indicators

**Buttons & Controls**:
- Primary actions: Solid background, rounded-lg
- Secondary actions: Border with transparent background
- Icon buttons: Square 32-40px with centered icon
- Toggle switches: For binary settings
- Segmented controls: For 2-4 mutually exclusive options (view modes, filters)

**Modals & Dialogs**:
- Center-screen overlay with backdrop blur
- Max width: 600px for forms, 900px for complex dialogs
- Header with title + close button
- Footer with Cancel (left) + Primary action (right)

## Workflow Builder Interface

**Canvas Area**:
- Infinite pan/zoom workspace with subtle dot grid background
- Minimap in bottom-right corner (120x80px)
- Zoom controls in bottom-left (buttons + percentage)
- Node library sidebar (left, 240px) with categorized draggable components
- Connection lines: Bezier curves with directional arrows

**Node Design**:
- Rounded rectangles (8px border radius)
- Clear input ports (left) and output ports (right)
- Icon + title + brief description layout
- Selected state: Border emphasis + shadow
- Grouped nodes: Dashed border container with group label

## Scene Editor Canvas

**Layout**: 
- Left toolbar (48px): Widget library icons (click to place on canvas)
- Center: Canvas with 16:9 aspect ratio representing stream overlay
- Right inspector (320px): Selected widget properties with live preview

**Canvas Controls**:
- Layer list (z-index management) at top of inspector
- Widget selection: Border + resize handles
- Alignment guides (snap-to) appear during drag
- Grid overlay toggle

## Asset Management

**Views**:
- Grid view: Thumbnail cards (180x180px) with filename underneath
- List view: Table with thumbnail (48px) + filename + size + date + actions
- Upload area: Dashed border drop zone at top, always visible
- Filters: File type selector + search + sort dropdown

## Theme System Implementation

**Mode Toggle**: Sun/moon icon button in sidebar footer
**Theme Selector**: Dropdown with preset options (Broadcast Blue, Production Purple, Classic Dark, Minimal Light)

**Dynamic Theming**:
- CSS variables for all theme values
- Smooth transitions (150-200ms) on theme changes
- Component variants adapt to current theme automatically

## Visual Enhancements

**Depth & Hierarchy**:
- Subtle shadows for elevated elements (cards, modals, dropdowns)
- Border usage: 1px borders for containers, no borders for flat layouts
- Background layers: Use 2-3 shades to create depth without heavy borders

**Interactive Feedback**:
- Hover states: Slight background shift + cursor change
- Loading states: Skeleton screens matching content structure
- Empty states: Icon + helpful message + primary action
- Error states: Inline validation with red accent + clear messaging

**Iconography**:
- Use Lucide React throughout for consistency
- Icon size: 16px (compact), 20px (standard), 24px (prominent)
- Pair icons with labels for primary navigation
- Icon-only for space-constrained areas (with tooltips)

**Animation Restraint**:
- Menu expand/collapse: 200ms ease-out
- Modal entrance: 150ms scale + fade
- Loading spinners only for operations > 500ms
- No decorative animations; all animations serve functional purpose

## Dashboard-Specific Patterns

**Overview Dashboard**:
- Quick stats row (4 cards across)
- Recent activity feed (left 2/3 width)
- Active workflows status (right 1/3 width)
- Quick actions panel at top

**Module Browser**:
- Filter sidebar (200px, collapsible)
- 3-column card grid with hover-to-reveal install button
- Category tabs or grouped sections
- "Installed" badge on owned modules

**Performance Considerations**:
- Virtual scroll for lists > 50 items
- Lazy load images with blur-up placeholders
- Paginated tables with "Load More" or infinite scroll
- Debounced search inputs (300ms)

This design system creates a professional, efficient interface that feels like a broadcast control center while remaining approachable for beginners. The emphasis is on spatial organization, clear information hierarchy, and quick access to frequent tasks.