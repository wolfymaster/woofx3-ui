# woofx3 Module System Specification

**Version:** 0.2  
**Status:** Draft  
**Scope:** Module system architecture — triggers, actions, workflows, widgets, overlays, and webhook integrations delivered via the barkloader module system.

> **Naming note:** "barkloader" and "barkloader-rust" refer to the same service. The service is currently named `barkloader-rust` and will be renamed to `barkloader` as the older barkloader service is deprecated. All references in this document use `barkloader`.

---

## 1. Overview & Goals

woofx3 is being refactored away from any hard-coded, built-in functionality. The platform itself becomes a shell and framework — a runtime host that provides infrastructure (NATS messaging, Temporal workflows, Convex UI backend, OBS integration) but ships with **no domain functionality of its own**.

All domain capability — alert widgets, Twitch event triggers, stream actions, overlays, webhook endpoints — must be delivered through the module system. This includes functionality that was previously "built-in", such as the alerts widget. That widget will become part of a default-loaded module (e.g., `alerts-core` or `twitch-platform`), but it is still a module.

**Core principle:** If it can't be installed via a module, it shouldn't exist in the platform.

---

## 2. Definitions

| Term | Definition |
|------|------------|
| **Module** | A self-contained package installed via barkloader. Declares triggers, actions, functions, workflows, widgets, and overlays it provides. |
| **Trigger** | An event source that can initiate a workflow (e.g., a Twitch subscription event, an incoming webhook call, a chat command). |
| **Action** | A callable unit of work that can be invoked as a workflow step (e.g., "play alert sound", "update overlay text"). |
| **Function** | A named callable (referenced as `#func call`) stored via barkloader's storage repositories and invoked by the runtime. |
| **Workflow** | A predefined or user-configured sequence of actions, initiated by a trigger. |
| **Widget** | A renderable UI component that can be added to a scene. Receives events as input and has its own settings. |
| **Overlay** | A scene manager/layout rendered as an OBS browser source. Receives events and routes them to the widgets it contains. |
| **Command** | A chat/bot command: a keyword or message pattern that triggers a workflow. Commands are the only mechanism through which end users (viewers) can directly initiate a workflow. |
| **Webhook Endpoint** | A platform-generated HTTP endpoint associated with a workflow. Allows 3rd-party systems to trigger workflows via HTTP. |

---

## 3. Module Manifest Format

Each module is a ZIP archive containing a `module.json` (or `module.yaml`) manifest at its root. The manifest declares all capabilities the module provides. The install key is computed as `version#sha256` of the ZIP — the same key cannot be reloaded for a given `application_id`.

### 3.1 Top-Level Manifest Structure

```json
{
  "id": "twitch-platform",
  "name": "Twitch Platform",
  "version": "1.0.0",
  "description": "Twitch eventbus triggers and platform actions",

  "triggers":  [ ... ],
  "actions":   [ ... ],
  "functions": [ ... ],
  "commands":  [ ... ],
  "workflows": [ ... ],
  "widgets":   [ ... ],
  "overlays":  [ ... ]
}
```

Top-level **`id`** and **`name`** are required. Every **capability** section in §3.1 (`triggers`, `actions`, `functions`, `commands`, `workflows`, `widgets`, `overlays`) is optional — a module may declare only triggers, only widgets, or any combination. There is no `permissions` section in the manifest.

**Barkloader (Rust)** accepts **only** this schema. There is **no** support for older manifest shapes (for example `workflowTriggers`, `functionName` / `fileName` function entries, a manifest `storage` block, or `commands` entries using `type: text` / `function`).

---

### 3.2 Triggers

A trigger declares an event source that the platform can listen for. At install time, the platform registers the trigger in the DB.

**Trigger deduplication:** Trigger IDs are global within an `application_id`. If a module attempts to register a trigger ID that already exists (e.g., `twitch.subscription` declared by two modules), the registration is silently skipped — the first module to register a given trigger ID wins. This does not cause an error and does not block the rest of the module from installing.

Triggers that originate from the Twitch event bus or other external event sources carry no permission requirements — they fire unconditionally when the platform receives the event.

```json
{
  "triggers": [
    {
      "id": "twitch.subscription",
      "name": "Twitch Subscription",
      "description": "Fires when a viewer subscribes on Twitch",
      "type": "eventbus",
      "schema": {
        "user": "string",
        "tier": "string",
        "is_gift": "boolean"
      }
    },
    {
      "id": "webhook.received",
      "name": "Incoming Webhook",
      "description": "Fires when the module's registered webhook endpoint receives a request",
      "type": "webhook"
    }
  ]
}
```

**Trigger types:**

- `eventbus` — subscribes to a NATS subject or internal event bus topic; no permission check
- `webhook` — platform creates a unique HTTP endpoint; incoming requests invoke the associated workflow; no permission check
- `command` — registered chat/bot command; fires when a viewer sends the matching message; **permission check applies** (see Section 5)
- `schedule` — cron or interval-based trigger (future)

---

### 3.3 Actions

An action is a named unit of callable work. It can be invoked as a step inside a workflow.

```json
{
  "actions": [
    {
      "id": "play.alert",
      "name": "Play Alert",
      "description": "Trigger the alert widget to play an animation",
      "call": "#func play_alert",
      "params": {
        "alert_type": "string",
        "duration_ms": "number"
      }
    }
  ]
}
```

---

### 3.4 Functions

Functions are named callables whose assets are stored via barkloader's existing storage repositories. The manifest registers them by reference; the runtime resolves and invokes them.

```json
{
  "functions": [
    {
      "id": "play_alert",
      "name": "Play Alert Handler",
      "runtime": "lua",
      "path": "functions/play_alert.lua"
    }
  ]
}
```

Function files are extracted from the module ZIP and stored in barkloader's storage repositories at install time. The path in the manifest is relative to the ZIP root.

---

### 3.5 Commands

Commands register a chat/bot keyword that triggers a workflow when matched. Commands are the **only** trigger type that end users (viewers) can initiate directly.

Every command has a `required_role` setting that controls who may invoke it. This defaults to `public` (anyone can trigger it). The role is configurable per-command in the UI after installation — the manifest value is the default.

```json
{
  "commands": [
    {
      "id": "cmd.clip",
      "name": "!clip",
      "pattern": "!clip",
      "type": "prefix",
      "workflow": "create_clip_workflow",
      "required_role": "public"
    },
    {
      "id": "cmd.ban",
      "name": "!ban",
      "pattern": "!ban",
      "type": "prefix",
      "workflow": "ban_user_workflow",
      "required_role": "moderator"
    }
  ]
}
```

**Command types:** `prefix` (message starts with pattern), `exact` (full message match), `regex`.

Before a command workflow is invoked, the platform checks that the user who sent the message belongs to the `required_role`. If they do not, the command is silently ignored. See Section 5 for the roles model.

---

### 3.6 Workflows

Pre-defined workflows bundled with a module. Users may also create workflows in the UI using triggers and actions from installed modules — the manifest form is for bundled/default workflows.

```json
{
  "workflows": [
    {
      "id": "on_subscription",
      "name": "New Subscription Alert",
      "trigger": "twitch.subscription",
      "steps": [
        { "action": "play.alert", "params": { "alert_type": "subscription" } }
      ]
    }
  ]
}
```

---

### 3.7 Widgets

A widget is a renderable UI component delivered by a module. When a user adds a widget to a scene in the UI, that creates a slot — **slots are not predefined in the manifest**. Each widget instance placed in a scene is its own slot. The widget receives events routed by the overlay/scene manager.

```json
{
  "widgets": [
    {
      "id": "alerts-widget",
      "name": "Alerts Widget",
      "description": "Renders stream alert animations",
      "entry": "widgets/alerts/index.html",
      "assets": "widgets/alerts/",
      "settings_schema": {
        "default_duration_ms": { "type": "number", "default": 5000 },
        "theme": { "type": "string", "default": "default" },
        "queue_mode": { "type": "string", "enum": ["stack", "concurrent"], "default": "stack" }
      },
      "accepted_events": ["twitch.subscription", "twitch.cheer", "twitch.raid"]
    }
  ]
}
```

- `entry` — the HTML entry point rendered in the OBS browser source
- `assets` — asset directory bundled with the module ZIP
- `settings_schema` — configurable settings surfaced in the UI; current values stored per instance in Convex DB under `application_id`
- `accepted_events` — list of trigger IDs this widget can handle; used by the overlay to route events to the correct widget instances

**How a widget handles events is part of its own settings.** For example, `queue_mode: stack` queues events sequentially; `queue_mode: concurrent` plays them simultaneously. These are declared in `settings_schema` and configured per instance in the UI. Custom widgets provided by modules must appear in the available widget list in the scene UI with their configured name and settings.

---

### 3.8 Overlays

An overlay is a scene manager and layout rendered as an OBS browser source. It receives events from woofx3 and routes them to the widget instances it contains. Overlays do not define slots in their manifest — slots are created dynamically as the user adds widget instances to the overlay in the UI.

```json
{
  "overlays": [
    {
      "id": "main-overlay",
      "name": "Main Stream Overlay",
      "description": "Default full-screen overlay",
      "entry": "overlays/main/index.html"
    }
  ]
}
```

The overlay:
- Is rendered as an OBS browser source
- Receives events pushed from woofx3 via Convex reactive queries
- Routes each event to widget instances whose `accepted_events` matches the trigger
- Does not own a static slot layout — widget placement is managed by the UI and stored in scene configuration

---

## 4. Database Schema (barkloader)

The following tables support the module system. All tables include `application_id` for multi-tenant scoping.

### 4.1 modules

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | FK, multi-tenant scope |
| module_id | string | from manifest |
| version | string | semver |
| key | string | `version#sha256`; unique per `(application_id, module_id, version)` — prevents re-upload |
| name | string | |
| status | enum | `active`, `disabled`, `error` |
| manifest | jsonb | full manifest stored at install time |
| installed_at | timestamp | |

Only one version of a given `module_id` may be `active` at a time per `application_id`. Multiple version rows may exist (e.g., previous versions set to `disabled`). An old version can be reactivated by setting it to `active` and disabling the current one. No existing settings are modified when switching versions — backward compatibility is the module author's responsibility.

### 4.2 triggers

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| module_id | string | the first module to register this trigger_id |
| trigger_id | string | unique per `application_id`; duplicate registrations from other modules are no-ops |
| trigger_type | enum | `eventbus`, `webhook`, `command`, `schedule` |
| settings | jsonb | |

### 4.3 actions

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| module_id | string | |
| action_id | string | |
| call | string | `#func` reference |
| params_schema | jsonb | |
| settings | jsonb | |

### 4.4 widgets

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| module_id | string | |
| widget_id | string | widget type from the manifest |
| name | string | |
| entry | string | asset path |
| settings | jsonb | current configured values for this instance |
| accepted_events | jsonb | array of trigger IDs |

### 4.5 overlays

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| module_id | string | |
| overlay_id | string | |
| name | string | |
| widget_instances | jsonb | ordered list of widget instance IDs placed in this overlay by the user |

### 4.6 commands

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| module_id | string | |
| command_id | string | |
| pattern | string | |
| type | string | `prefix`, `exact`, `regex` |
| workflow_id | uuid | FK to workflows |
| required_role | string | role name; default `public`; configurable in UI |

### 4.7 workflows

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| module_id | string | null if user-created |
| workflow_key | string | idempotency key (`version#hash` for module workflows; user-assigned for custom) |
| name | string | |
| trigger_id | uuid | FK to triggers |
| steps | jsonb | ordered action steps |

### 4.8 webhook_endpoints

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| application_id | uuid | |
| endpoint_id | string | unique, URL-safe identifier |
| workflow_id | uuid | FK to workflows |
| secret | string | for request signing/verification |
| created_at | timestamp | |

---

## 5. Roles & Permissions Model

Permissions in woofx3 apply **only to commands**. Commands are the only trigger type that end users (viewers) can initiate. Eventbus triggers, webhook triggers, and schedule triggers carry no permission requirements and always fire unconditionally when the platform receives the event.

### 5.1 How Command Permissions Work

Before invoking a command's workflow, the platform checks the role of the user who sent the message against the command's `required_role`. If the user does not have the required role, the command is silently ignored. This check is enforced by barkloader before handing off to the workflow engine.

### 5.2 Roles

Roles are managed at the `application_id` level. The platform ships with a default set of roles (e.g., `public`, `subscriber`, `moderator`, `broadcaster`). Custom roles may be added.

### 5.3 UI Requirement

The UI must display the list of available roles/groups. When a user adds or configures a command, they select the `required_role` from this list. The default is always `public`. There is no other roles/permissions management UI at this time beyond listing available roles for command configuration.

---

## 6. Installation Flow (barkloader)

When a module ZIP is submitted for installation:

1. Validate the ZIP is well-formed and contains a valid manifest
2. Compute `version#sha256` key — reject if this exact key is already installed for this `application_id`
3. Check whether another version of this `module_id` is currently `active` — if so, it must be deactivated first
4. Parse and validate each manifest section against its schema
5. Insert row into `modules` with `status = active`
6. For each declared **trigger**: insert into `triggers` if `trigger_id` does not already exist for this `application_id`; otherwise skip silently
7. Insert rows into `actions`, `widgets`, `overlays`, `commands`, and `workflows` as declared
8. Extract function assets from the ZIP and store them in barkloader's storage repositories
9. Emit a `module.installed` event on NATS

No permissions are registered at install time. Command `required_role` values are set from the manifest defaults and remain configurable in the UI.

---

## 7. Default Modules & Boot Auto-Install

All built-in functionality is delivered as modules. Default modules live in the `modules/` directory of the barkloader repository (currently `barkloader-rust`).

At service boot, barkloader runs an **auto-install script** that scans the `modules/` directory and installs any module not yet active for the current `application_id`. Modules already installed at the current `version#sha256` are skipped.

Default modules to be created:

| Module | Location | Provides |
|--------|----------|---------|
| `alerts-core` | `modules/alerts-core/` | Alerts widget, alert action |
| `twitch-platform` | `modules/twitch-platform/` | All Twitch eventbus triggers (subscription, cheer, raid, follow, bits, etc.) |
| `obs-core` | `modules/obs-core/` | OBS scene control actions, scene-change triggers |

These modules are installed through the normal installation path and can be disabled or replaced.

---

## 8. UI Layer (Convex DB)

The following data is stored in Convex and drives the UI:

- **Scenes** — active overlay instances; tracks which widget instances are placed and their configuration
- **Configured widgets** — per-instance widget settings (values from `settings_schema`)
- **Users** — user accounts and role assignments
- **Platform settings** — per-application configuration
- **Webhook endpoints** — provisioned endpoints for display and management in the UI

### 8.1 Creating a Workflow in the UI

1. Select a **trigger** from the list of triggers registered by installed modules
2. Select one or more **actions** from the list of actions registered by installed modules
3. Name and save the workflow

### 8.2 Configuring a Command in the UI

When adding or editing a command (from an installed module or user-created):

1. Set the `pattern` and `type`
2. Select the `required_role` from the displayed list of available roles — defaults to `public`
3. Associate with a workflow

---

## 9. Webhook Endpoint System

Modules (and users) can provision HTTP webhook endpoints that invoke a workflow when called by a 3rd party.

### 9.1 Flow

```
3rd-party HTTP request
  → Webhook Endpoint (unique URL, e.g. /webhooks/{endpointId})
  → woofx3 API validates request signature
  → Lookup workflow associated with endpointId
  → Invoke workflow with trigger `webhook.{endpointId}.trigger`
  → Pass request body as workflow trigger params
```

### 9.2 Endpoint Provisioning

- Users create webhook endpoints in the UI (or a module may declare a `webhook` trigger type to auto-provision one)
- The platform generates a unique `endpoint_id` and a signing secret
- The endpoint URL and secret are displayed to the user for configuration in the 3rd-party system
- The endpoint is associated with a specific workflow at creation time

### 9.3 Trigger Convention

```
webhook.{endpointId}.trigger
```

The full request body is passed through as workflow trigger parameters.

---

## 10. UI Endpoint (Signed Requests)

woofx3 exposes a **UI Endpoint** that accepts signed requests from the woofx3 instance (barkloader, workflow engine, etc.). All requests include the `woofx3 instance ID`. This is the integration point through which internal platform changes notify the Convex-backed UI layer — scene changes, widget state updates, module install/uninstall events, and so on.