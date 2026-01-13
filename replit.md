# StreamControl - Live Stream Management Platform

## Overview

StreamControl is a professional live stream management platform that provides workflow automation, asset management, scene editing, and module integrations for content creators. The application follows a "Professional Control Plane" design philosophy, blending production control interface patterns (like Premiere Pro and OBS Studio) with modern dashboard design elements.

The platform enables users to manage streaming workflows, install and configure modules (integrations like Twitch, chat commands), organize media assets, and build broadcast scenes with a visual editor.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: Nanostores for global state (theme, sidebar, user context)
- **Data Fetching**: TanStack React Query for server state management
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables for theming
- **Drag & Drop**: @dnd-kit for sortable interfaces
- **Workflow Builder**: ReactFlow for node-based workflow visualization
- **Animations**: Framer Motion for UI transitions

### Backend Architecture
- **Runtime**: Node.js with Express
- **API Style**: RESTful JSON API with pagination support
- **Development Server**: Vite dev server with HMR, proxied through Express
- **Build System**: esbuild for server bundling, Vite for client bundling

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` contains database table definitions
- **Migrations**: Drizzle Kit for schema migrations (`drizzle-kit push`)
- **Validation**: Zod schemas generated from Drizzle schemas via drizzle-zod

### Project Structure
```
client/           # React frontend application
  src/
    components/   # UI components (layout, common, ui)
    pages/        # Route page components
    hooks/        # Custom React hooks
    lib/          # Utilities, API client, stores
    types/        # TypeScript type definitions
server/           # Express backend
  index.ts        # Server entry point
  routes.ts       # API route definitions
  storage.ts      # Data storage interface
shared/           # Shared code between client/server
  schema.ts       # Database schema definitions
```

### Design System
- Dark mode by default with light mode support
- Theme presets with customizable color schemes
- Consistent spacing scale using Tailwind units
- Typography: Inter for interface, JetBrains Mono for code
- Collapsible sidebar navigation pattern

## External Dependencies

### Database
- **PostgreSQL**: Primary database (configured via DATABASE_URL environment variable)
- **Drizzle ORM**: Type-safe database queries and schema management

### UI Framework
- **Radix UI**: Accessible component primitives (dialog, dropdown, tabs, etc.)
- **Shadcn/ui**: Pre-built component implementations
- **Tailwind CSS**: Utility-first styling

### Build Tools
- **Vite**: Frontend build tool and dev server
- **esbuild**: Server-side bundling for production
- **TypeScript**: Type checking across the codebase

### Key Runtime Libraries
- **TanStack React Query**: Server state management and caching
- **ReactFlow**: Visual workflow/node editor
- **@dnd-kit**: Drag and drop functionality
- **Framer Motion**: Animation library
- **Wouter**: Lightweight client-side router
- **Nanostores**: Atomic state management

### Replit-Specific
- `@replit/vite-plugin-runtime-error-modal`: Error overlay in development
- `@replit/vite-plugin-cartographer`: Development tooling
- `@replit/vite-plugin-dev-banner`: Development environment indicator