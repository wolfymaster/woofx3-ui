# CLAUDE.md - Codebase Guide for LLM Coding Agents

## Project Overview

**Woofx3** (also known as StreamControl) is a unified streaming control plane - a professional live stream management platform that provides workflow automation, asset management, scene editing, and module integrations for content creators.

The application follows a "Professional Control Plane" design philosophy, blending production control interface patterns (like Premiere Pro and OBS Studio) with modern dashboard design elements.

**Important Note**: This is currently a monorepo containing a React UI application for the web interface. A Tauri application for the desktop interface is planned. Both applications should share the same components and layouts and only differ in platform-specific features.

## Architecture Overview

### Project Structure

```
client/           # React frontend application
  src/
    components/   # UI components (layout, common, ui from shadcn/ui)
    pages/        # Route page components
    hooks/        # Custom React hooks
    lib/          # Utilities, API client, stores, RPC client
    types/        # TypeScript type definitions
server/           # Express backend
  index.ts        # Server entry point
  api-server.ts   # Cap'n Web RPC API server implementation
  routes.ts       # API route definitions (RPC endpoints)
  storage.ts      # Data storage interface (currently in-memory)
  static.ts       # Static file serving for production
  vite.ts         # Vite dev server integration
  ws-adapter.ts   # WebSocket adapter for browser compatibility
shared/           # Shared code between client/server
  api.ts          # StreamControlApi interface contract (RPC methods)
  schema.ts       # Database schema definitions (Drizzle ORM)
script/           # Build and utility scripts
  build.ts        # Build script for production
```

### Technology Stack

**Frontend:**
- React 18 with TypeScript
- Vite 7 for bundling and dev server
- Wouter for client-side routing
- TanStack React Query for server state management
- Nanostores for global UI state (theme, sidebar, user context)
- XState (available but not yet extensively used - intended for complex state machines)
- Shadcn/ui component library (built on Radix UI primitives)
- Tailwind CSS with CSS variables for theming
- ReactFlow for node-based workflow visualization
- Framer Motion for UI animations
- @dnd-kit for drag-and-drop interfaces

**Backend:**
- Bun runtime with Express
- Cap'n Web RPC (capnweb) for type-safe RPC communication
- Drizzle ORM with PostgreSQL
- WebSocket support via `ws` library
- Express sessions with connect-pg-simple (PostgreSQL) or memorystore

**Database:**
- PostgreSQL (configured via DATABASE_URL environment variable)
- Drizzle ORM for type-safe database queries
- Drizzle Kit for schema migrations (`bun run db:push`)
- Zod schemas generated from Drizzle schemas via drizzle-zod

**Build System:**
- Vite for client bundling
- esbuild for server bundling (with selective dependency bundling)
- TypeScript 5.6 with strict mode
- ESM modules (`"type": "module"` in package.json)
- **Runtime**: Bun (runs TypeScript natively, no compilation step needed for dev)

## API Architecture: Cap'n Web RPC

The application uses **Cap'n Web RPC** (https://github.com/cloudflare/capnweb) - a JavaScript-native, low-boilerplate RPC system.

### Key Files
- **Shared Contract**: `shared/api.ts` defines the `StreamControlApi` interface
- **Server Implementation**: `server/api-server.ts` implements `StreamControlApiServer extends RpcTarget`
- **Client**: `client/src/lib/rpc-client.ts` provides typed RPC stubs

### RPC Endpoints
- **WebSocket RPC**: `/rpc` - Persistent connection, good for real-time operations
- **HTTP Batch RPC**: `POST /rpc` - Single request, good for one-off calls

### Client Usage Pattern

```typescript
import { api } from '@/lib/rpc-client';

// WebSocket (persistent connection, singleton)
const user = await api.ws.getUser();
const workflows = await api.ws.getWorkflows({ page: 1 });

// HTTP batch (creates new session per call)
const stats = await api.http.getDashboardStats();
```

### Server Implementation Pattern

The server creates a new `StreamControlApiServer` instance per RPC session (both WebSocket and HTTP). Each WebSocket connection gets its own session, and each HTTP batch request gets its own session.

**Important**: The WebSocket client uses a singleton pattern - there's one persistent connection reused across the application.

## State Management

### Nanostores (Global UI State)
Located in `client/src/lib/stores.ts`. Used for:
- Theme preferences (persisted to localStorage)
- Sidebar collapsed state (persisted to localStorage)
- User context
- Account/Team selection

### TanStack React Query (Server State)
Used for all server data fetching and caching. Configured in `client/src/lib/queryClient.ts`.

## TypeScript Configuration

### Path Aliases (Important for Imports)

Configured in both `tsconfig.json` and `vite.config.ts`:

- `@/*` → `client/src/*` (e.g., `@/components`, `@/lib`, `@/hooks`)
- `@shared/*` → `shared/*` (e.g., `@shared/api`, `@shared/schema`)
- `@assets/*` → `attached_assets/*` (only in Vite config)

**Always use these path aliases instead of relative paths** for imports from `client/src` and `shared`.

### TypeScript Settings
- Strict mode enabled
- ESNext modules
- JSX preserve (React 18)
- Bundler module resolution
- Includes: `client/src/**/*`, `shared/**/*`, `server/**/*`
- Excludes test files

## Development Workflow

### Scripts (package.json)
- `bun run dev` - Start development server (Express + Vite dev server with HMR)
- `bun run build` - Build for production (client via Vite, server via esbuild)
- `bun run start` - Start production server
- `bun run check` - Type check with TypeScript
- `bun run db:push` - Push database schema changes (Drizzle Kit)

**Note**: This project uses Bun as the runtime. Bun runs TypeScript natively, so no compilation step is needed for development.

### Development Server
- Runs on port specified by `PORT` environment variable (default: 5000)
- **Critical**: The server MUST run on the port specified by `PORT` - other ports are firewalled
- In development: Vite dev server proxied through Express
- In production: Static files served from `dist/public`
- Vite HMR available in development via `/vite-hmr` WebSocket endpoint

### Build Process
1. Client: Vite bundles React app to `dist/public`
2. Server: esbuild bundles server code to `dist/index.cjs` (CommonJS)
   - Selective dependency bundling (only allowlisted deps are bundled)
   - All other deps remain external
   - Minified in production

## Database & Schema

### Schema Location
- **Schema Definitions**: `shared/schema.ts` (Drizzle ORM tables)
- **Migrations**: Generated in `./migrations` directory
- **Config**: `drizzle.config.ts`

### Schema Management
- Use `drizzle-kit push` to push schema changes
- Schema uses PostgreSQL dialect
- Zod schemas can be generated from Drizzle schemas using `drizzle-zod`

### Current Schema
Basic user table exists. The API contracts in `shared/api.ts` define more complex types (Workflows, Modules, Assets, Scenes) that will need corresponding database tables.

## Code Style & Patterns

### Principles
- **Single Responsibility Principle**: Each function/component should have one clear purpose
- **Clear Boundaries**: Maintain clear separation between client, server, and shared code
- **Self-Documenting Code**: Code should be readable without excessive comments
- **Comments for Ambiguity**: Use comments to explain non-obvious decisions or complex logic
- **Linting**: Always respect linting rules

### Component Organization
- **Reusable Components**: Create reusable components in `client/src/components`
- **UI Components**: Shadcn/ui components in `client/src/components/ui`
- **Page Components**: Route handlers in `client/src/pages`
- **Shared Logic**: Utilities, stores, and helpers in `client/src/lib`

### State Management Patterns
- **Global UI State**: Use Nanostores (`client/src/lib/stores.ts`)
- **Server State**: Use TanStack React Query
- **Complex State Machines**: Use XState (when needed)
- **Local Component State**: Use React `useState` for component-specific state

## Design System

See `design_guidelines.md` for comprehensive design system documentation.

**Key Points:**
- Dark mode by default, light mode supported
- Theme system uses CSS variables
- Shadcn/ui components with "new-york" style
- Tailwind CSS with custom design tokens
- Typography: Inter for interface, JetBrains Mono for code
- Consistent spacing scale
- Professional control plane aesthetic

## API Contract

The API contract is defined in `shared/api.ts` as TypeScript interfaces. The `StreamControlApi` interface defines all available RPC methods.

**Key Types:**
- Pagination: `PaginationParams`, `PaginatedResponse<T>`
- Core Entities: `User`, `Team`, `Account`, `Module`, `Workflow`, `Asset`, `Scene`
- Query Types: `ModulesQuery`, `WorkflowsQuery`, `AssetsQuery`, `ScenesQuery`
- Input Types: `CreateWorkflowInput`, `UpdateWorkflowInput`, etc.

All API methods return Promises and are type-safe across client and server.

## Important Notes for LLM Agents

1. **Port Configuration**: The server MUST run on the port specified by `PORT` env var. This is critical - other ports are firewalled.

2. **Path Aliases**: Always use `@/` for client/src imports and `@shared/` for shared imports. Never use relative paths that go outside these boundaries.

3. **RPC Pattern**: The server creates new `StreamControlApiServer` instances per session. Don't try to share state between sessions at the API server level.

4. **State Management**: Currently uses Nanostores + React Query. XState is available but not yet used. Don't introduce XState unless implementing complex state machines.

5. **Build System**: Client and server have separate build processes. Client uses Vite, server uses esbuild with selective bundling.

6. **Database**: Currently using in-memory storage (`MemStorage`). Database schema exists but full PostgreSQL integration may not be complete.

7. **Shared Code**: Types and interfaces shared between client and server go in `shared/`. API contract is in `shared/api.ts`.

8. **Component Library**: Uses Shadcn/ui. Components are in `client/src/components/ui`. Don't modify these directly - use composition and extend them.

9. **Type Safety**: The codebase uses strict TypeScript. All API calls are type-safe via Cap'n Web RPC contracts.

10. **Development vs Production**: Development uses Vite dev server with HMR. Production serves static files and runs bundled server code.

## Future Considerations (Tauri Desktop App)

When implementing the Tauri desktop application:
- The React UI code should be mostly shareable
- The Tauri backend (Rust) will proxy API requests - the React UI should NOT make requests directly
- Platform-specific features should be isolated
- Use the same component library and design system

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
