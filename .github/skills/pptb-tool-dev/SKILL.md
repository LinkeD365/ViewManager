---
name: pptb-tool-dev
description: Build, fix, debug, validate, or publish a tool for Power Platform ToolBox (PPTB) — the Electron desktop app for the Microsoft Power Platform / Dataverse ecosystem (github.com/PowerPlatformToolBox). Use this any time someone wants to scaffold a new PPTB tool, wire up toolboxAPI/dataverseAPI/powerplatformAPI calls, add inter-tool invocation (launchTool/getLaunchContext/returnData), expose a tool to AI assistants through PPTB's MCP/agent integration, add or fix CSP exceptions, fix a package.json or pptb.config.json manifest, run pptb-validate, debug a tool loaded in PPTB, or publish a tool to npm and the PPTB registry. Also trigger on mentions of Dataverse DevTools (DVDT, its deprecated predecessor), Power Platform ToolBox, cspExceptions, configurations.repository/readmeUrl, or a tool failing to load/validate inside PPTB — even if the person doesn't say "PPTB" by name.
license: GPL-3.0
# allowed-tools intentionally omitted: the workflow below runs npm/npx/yo commands
# (yo pptb, npm install, npm run build, npx pptb-validate, npm publish). These are
# ordinary dev-tooling invocations, but `npm publish` is irreversible and worth a
# manual confirm — leave this unset so the agent asks each time, unless this repo's
# maintainers have reviewed the workflow and want to pre-approve specific commands.
---

# PPTB Tool Development

Power Platform ToolBox (PPTB) tools are small web apps (HTML/CSS/JS or React/Vue/Svelte) that run inside an isolated Electron `BrowserView` and talk to the host through `window.toolboxAPI`, `window.dataverseAPI`, and (optionally) `window.powerplatformAPI`. They are npm packages, installed from the PPTB registry or loaded locally for development.

Building a "fully functioning" tool means getting **all** of these right, not just the UI:
1. A `package.json` manifest that passes `pptb-validate`
2. A build output that PPTB can actually load (this has a real, non-obvious gotcha — see below)
3. Correct use of the host APIs for what the tool needs to do
4. A maintainable UI architecture with Fluent controls, services, and a view model
5. CSP exceptions declared if the tool talks to anything besides Dataverse
6. (Optional) inter-tool invocation and/or agent/MCP integration, if the tool should be launchable by other tools or by an AI assistant

## Step 0: Figure out what's actually being asked

Most requests are one of:
- **"Build me a PPTB tool that does X"** → full workflow below, start at Step 1.
- **"Fix my tool, it won't load / validate / publish"** → skip to Step 4 (validation) or `references/build-and-csp.md`, and inspect the actual `package.json`/build output before guessing.
- **"Make my tool launchable from another tool"** or **"expose my tool to an agent via MCP"** → the tool already exists; read `references/invocation.md` or `references/agent-integration.md` directly, don't re-scaffold.

Don't assume — if a tool directory already exists, read it first. Recommendations must be grounded in the actual files present, not generic boilerplate.

## Step 1: Scaffold with the official generator

PPTB has an official Yeoman generator. Always scaffold new tools with it rather than hand-writing the project skeleton — it produces the correct Vite config (including the IIFE/single-bundle output PPTB requires, and dev-mode sourcemaps), `dev-watch` script, and folder layout for HTML/React/Vue/Svelte.

```bash
npm install -g yo generator-pptb
yo pptb my-tool
# or, without a global install:
npx --package yo --package generator-pptb -- yo pptb my-tool
```

Follow the interactive prompts to pick a framework. Then install the type definitions:

```bash
npm install --save-dev @pptb/types
```

If a person wants a *pattern* to follow (not scaffolding) — e.g. "how does a real ERD generator tool structure its Dataverse calls" — the `Power-Maverick/PPTB-Tools` GitHub org has real, shipped community tools worth reading for conventions. Don't use it as a scaffold source; the generator is the source of truth for project structure.

## Step 2: Implement against the right API surface

Read `references/apis.md` for the full quick-reference of `toolboxAPI`, `dataverseAPI`, and `powerplatformAPI`. Key things to get right up front:

- `window.toolboxAPI` is **only defined when running inside PPTB** — never in a standalone browser tab. If someone reports `toolboxAPI is undefined`, that's almost always the cause (or a missed `/// <reference types="@pptb/types" />` for editor typing).
- `ToolContext` deliberately has no access tokens — Dataverse calls always go through `dataverseAPI`, never a manually-constructed fetch with a bearer token.
- Every `dataverseAPI` and `powerplatformAPI` method takes an optional trailing `connectionTarget: 'primary' | 'secondary'` — only relevant if the tool declares `features.multiConnection`.
- Wrap all API calls in try/catch and surface failures via `toolboxAPI.utils.showNotification(...)`, not raw `alert()` or console-only errors — see `references/apis.md` for the error-handling conventions PPTB tools follow.

### Preferred React architecture

For React tools, default to **Fluent UI v9 + a service layer + a MobX view model** unless the existing tool already has a coherent alternative architecture. Preserve an established codebase pattern rather than forcing a rewrite.

Use the layers deliberately:

- **React components** render the UI and translate user gestures into view-model actions. Keep them small, typed, and wrapped in `observer` only when they read observable state. They should not contain Dataverse queries, business rules, or direct host API calls.
- **Split distinct screen areas into separate controls**, each in its own component file with one clear responsibility (for example, a header/filter toolbar, a primary grid, and a selected-record details/access panel). Keep the parent screen focused on layout and loading/action coordination. Give child controls only the display data and callbacks they need, not the entire view model or a concrete service. Keep their props interfaces in the view-model module, and preserve selection, loading/error states, sorting, pagination, accessibility and popup layering when extracting controls.
- **The view model** owns observable screen/domain state, derived state, loading and error state, selection, and user-facing actions. Construct it once per tool instance, use `makeAutoObservable`, and keep state transitions cohesive. Prefer computed values over duplicated state.
- **Interfaces belong in the view-model module**, including domain records, component/service props, and service contracts. The view model must not import or depend on a concrete Dataverse service. Define a narrow service interface in the view-model module and accept that contract instead; concrete services implement it, and services/components use type-only imports from the view-model module. Keep concrete service construction in the app composition root so the view model can be tested with fakes.
- **Services** encapsulate `dataverseAPI`, `toolboxAPI`, and `powerplatformAPI` calls. Inject API objects, the active connection/target, and logging or notification dependencies through the constructor. Services must not import React or own presentation state.
- **The app composition root** obtains PPTB context, theme, and connection state; creates services and the view model; and wires dependencies together. Do not scatter construction or global API access throughout the component tree.

Apply SOLID principles pragmatically:

- Give each component, view model, and service one clear responsibility.
- Depend on narrow interfaces when that improves testability; do not add interfaces or factories that have only speculative value.
- Extend behavior through focused methods or collaborators instead of growing a single component or service into an all-purpose class.
- Keep host-specific details at the service boundary so view-model logic can be tested with fakes.
- Use dependency injection rather than hidden mutable globals. `window.*API` should normally be read only at the composition root.
- Avoid `any`, non-null assertions, and success-shaped fallbacks. Model `null` connections and unavailable services explicitly and disable or replace dependent UI until they are ready.

### Fluent UI conventions

- Use `@fluentui/react-components` (Fluent UI v9) controls instead of hand-rolled equivalents whenever an appropriate control exists.
- Wrap the tool in `FluentProvider` and map PPTB's current theme to `webLightTheme` or `webDarkTheme`. Respond to theme updates from the host.
- Style with `makeStyles` and Fluent `tokens`; avoid hard-coded colors, spacing, typography, and ad hoc inline styles.
- Use `@fluentui/react-icons` for standard actions. Icon-only controls require a meaningful `aria-label` and, where useful, a tooltip.
- Prefer semantic Fluent components such as `Toolbar`, `ToolbarButton`, `Button`, `Input`, `Dropdown`, `DataGrid`, `Dialog`, `MessageBar`, `Spinner`, and `Tooltip`.
- For data grids and table-style components, prefer AG Grid over Fluent `DataGrid`; continue using Fluent UI for the surrounding controls and layout.
- Set `inlinePopup` on Fluent `Combobox` and `Dropdown` controls so the listbox renders inside the tool's `FluentProvider` tree rather than a detached portal. If the inline popup is overlapped by neighbouring content such as an AG Grid, give the control's container `position: "relative"` and a `zIndex` above the grid instead of removing `inlinePopup`.
- Preserve keyboard navigation, focus behavior, accessible names, contrast, loading indicators, empty states, and disabled states.
- Do not log from render functions. Route diagnostic output through the tool's logging abstraction and user-actionable failures through PPTB notifications.

For a typical structure, use:

```text
src/
  components/       # Thin observer views and reusable presentation components
  model/            # View models and domain-facing types
  services/         # PPTB, Dataverse, and Power Platform adapters
  hooks/            # React lifecycle integration with host events/context
  App.tsx            # Composition root and FluentProvider
```

When adding or changing behavior, test view-model state transitions and service request/error handling independently where the project has a test setup. Component tests should focus on rendering, accessibility, and user interaction rather than re-testing service internals.

## Step 3: Write the manifest

`package.json` (and, if the tool needs invocation or agent support, `pptb.config.json`) drive everything: what PPTB shows the user, what CSP exceptions are granted, and what `pptb-validate`/the registry review will accept.

Read `references/manifest.md` before writing or editing either file — the required-field shape is stricter and more nested (`configurations.repository`, `configurations.readmeUrl`) than the simplified examples in PPTB's own quickstart docs, which will pass a casual read but fail `pptb-validate`.

If the tool needs CSP exceptions (any external domain besides `*.dynamics.com`), read `references/build-and-csp.md` — least-privilege domains only, never wildcards like `"*"` or bare `https:`.

## Step 4: Validate locally before anything else

```bash
npm install --save-dev @pptb/types   # installs the pptb-validate binary
npx pptb-validate --skip-url-checks  # fast local run
```

Fix every **error** before proceeding (missing/malformed required fields). Warnings are optional-but-recommended and worth fixing too, but don't block. See `references/debugging-publishing.md` for CI integration and the full field-by-field validation table.

## Step 5: Debug inside PPTB

Never attempt browser checks for PPTB tools: do not open a standalone browser or preview, run browser automation or screenshot checks, or mock host APIs to render the tool outside PPTB. These tools depend on the external PPTB host framework. Validate with builds, type checks, manifest validation, and service/view-model tests instead. Leave rendering and live integration checks to the user inside PPTB, and explicitly state when those checks remain unverified.

Tools generated by `yo pptb` already have `dev-watch` and dev-mode sourcemaps wired up. The debug loop is: `npm run dev-watch` → enable "Show Debug Menu" in PPTB Settings → Debug sidebar → Load Local Tool (point at the project **root**, not `dist/`) → Help menu → Toggle Tool DevTools. There's no hot-reload — close and reload the tool tab after each rebuild. Full walkthrough in `references/debugging-publishing.md`.

## Step 6: Publish

`npm run build` → `pptb-validate` clean → `npm run finalize-package` → `npm publish --access public` (scoped packages need `--access public`) → submit via the Tool Submission Form. Full steps, versioning conventions, and troubleshooting in `references/debugging-publishing.md`. This step is irreversible (published npm versions can't be unpublished after 72 hours) — confirm with whoever's asking before actually running `npm publish`.

## Optional: cross-tool and agent capabilities

Only read these when the request actually calls for them — they add real complexity and shouldn't be bolted onto every tool by default:

- **`references/invocation.md`** — one PPTB tool launching another, passing prefill data, and getting a result back (`toolboxAPI.invocation.launchTool/getLaunchContext/returnData`, capability-tag discovery). Needed when a tool should be callable from other installed tools (e.g., a "Send To ▾" flyout, an entity picker other tools can launch).
- **`references/agent-integration.md`** — exposing a tool to AI assistants through PPTB's built-in MCP server, including the `agents` block in `pptb.config.json` and the `invokeHeadless(input, context)` runtime for unattended runs. Needed when a tool should be discoverable/invokable by an assistant like Claude or Copilot, not just by a human clicking around.

Both build on the same `pptb.config.json` `invocation` contract (`capabilities`, `prefill`, `returnTopic`), so read `invocation.md` first even if the end goal is agent integration — `agent-integration.md` assumes that contract already exists.

## A note on doc drift

PPTB's own getting-started page ships a simplified `package.json` example that's looser than what `pptb-validate` actually enforces, and the Agent Integration docs describe a fairly complete headless-execution runtime (`invokeHeadless`, `executionModes`, `headlessEntry` discovery order) that may be ahead of what's actually shipped in a given `desktop-app` release. If something in a reference file seems more advanced than the installed PPTB version supports, say so rather than assuming the docs are fully live — check the installed app's version/changelog or ask.