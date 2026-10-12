# ViewStudio technical implementation

For application usage, see the [ViewStudio user guide](README.md).

## Stack and host

ViewStudio uses React 18, TypeScript, Fluent UI v9, MobX and AG Grid Community.
It runs inside Power Platform ToolBox (PPTB), which supplies `toolboxAPI` and
`dataverseAPI`. Dataverse requests use the host API, not manually managed access
tokens.

## Architecture

- [App.tsx](src/App.tsx) obtains the connection and theme, constructs the service
  and view model, and supplies logging and notification callbacks.
- [viewModel.tsx](src/model/viewModel.tsx) owns application state, all application
  interfaces, the `ViewDataService` contract and access-rights definitions.
  It does not depend on the concrete Dataverse service.
- [dataverseService.tsx](src/services/dataverseService.tsx) implements that
  contract, constructs requests, maps responses and logs API failures.
- [viewStudio.tsx](src/components/viewStudio.tsx) coordinates loading, user
  actions and the two-panel layout.

Distinct UI areas are separate controls with focused display-data and callback
props:

| Control | Responsibility |
| --- | --- |
| [ViewStudioHeader](src/components/viewStudioHeader.tsx) | Searchable owner filter and refresh action |
| [PersonalViewsGrid](src/components/personalViewsGrid.tsx) | View columns, sorting, pagination and selection |
| [ViewAccessPanel](src/components/viewAccessPanel.tsx) | Sharing records, save/discard actions and status |
| [ViewAccessEditor](src/components/viewAccessEditor.tsx) | Compact permission multi-select list box in a dialog |
| [ViewAccessUserPicker](src/components/viewAccessUserPicker.tsx) | Searchable user selection for a new access row |

Controls do not call Dataverse directly. Their interfaces remain in the
view-model module. Fluent dropdowns use `inlinePopup`; the header's positioned
stacking layer keeps its owner picker above the grids.

The root `FluentProvider` sets `applyStylesToPortals={false}` so its full-screen
layout classes are not copied to tooltip/dialog portal containers. Theme tokens
are still provided, and tooltips use Fluent's default mounting behavior without
per-control `document.body` overrides.

## Reading Dataverse data

| Purpose | API/query |
| --- | --- |
| Available owners | FetchXML on `systemuser`, ordered by full name |
| Current user | `execute` with the `WhoAmI` function |
| Personal views | FetchXML on `userquery`, optionally filtered by owner |
| Table display names | `getAllEntitiesMetadata(["LogicalName", "DisplayName"])` |
| View sharing | FetchXML on `principalobjectaccess`, filtered by selected view ID |

The owner query requires `isdisabled = 0`, `applicationid` null and
`systemmanagedusertype = 0`, and excludes access modes `3` and `5`.

Table names display as `Display Name (logicalname)`. The service caches the
metadata promise so overlapping requests share one load. Failed metadata loads
clear the cache for retry. A new service instance gets a new cache when the
connection changes.

The sharing query uses object type `4230`, principal types `8` and `9`, outer
joins to `systemuser` and `team`, `distinct`, `latematerialize`, a union filter
hint and `top="51"`. Response mapping accepts both numeric principal types and
the logical names `systemuser` and `team`. The UI warns when 51 rows are returned;
it does not page beyond that limit.

These are sharing records, not a complete effective-access calculation.

## Access-rights editing

Rights use Microsoft's [AccessRights enum](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/accessrights?view=dataverse-latest):

| Value | Member | Display |
| --- | --- | --- |
| 0 | None | None |
| 1 | ReadAccess | Read |
| 2 | WriteAccess | Write |
| 4 | AppendAccess | Append |
| 16 | AppendToAccess | Append to |
| 32 | CreateAccess | Create |
| 65536 | DeleteAccess | Delete |
| 262144 | ShareAccess | Share |
| 524288 | AssignAccess | Assign |

The model stores pending masks separately from loaded records, keyed by
principal type and ID. Grid values reflect pending masks, while reverting a mask
to its saved value clears that pending edit. Unknown bits remain visible and
are blocked from editing rather than silently removed.

The editor exposes only Read, Write, Delete, Share and Assign. Its selection
mapping replaces those bits while preserving existing Create, Append and Append
to bits. The grid and service still decode and serialize the full enum.

The Add user action creates a pinned draft row and opens a searchable picker.
Candidates reuse the active-user list and exclude loaded and pending direct
user shares by case-insensitive ID. Selected users enter a separate pending
additions collection with Read access. The placeholder row cannot be saved
until a user is chosen; cancellation removes only the placeholder. Clearing a
pending addition's mask removes it locally without issuing a revoke.

The user-row Delete action stages a zero mask for the entire direct share,
including hidden or unrecognized rights. Rows with pending zero masks are
excluded from the displayed grid immediately, while their saved records remain
available for revocation or restoration through Discard. It uses the same Save/Discard flow;
unlike selective editing it deliberately revokes all direct rights. For an
unsaved new user it removes the local addition without a Dataverse request.

Saving calls `dataverseAPI.execute` with an unbound action:

- [GrantAccess](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/grantaccess?view=dataverse-latest)
  for new users, with a typed target and `PrincipalAccess`. Successful additions
  become saved rows immediately, so retries do not re-grant successful shares.
- [ModifyAccess](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/modifyaccess?view=dataverse-latest)
  for nonzero masks: `Target` identifies the `userquery`, and `PrincipalAccess`
  contains a typed user/team entity and comma-separated enum member names.
- [RevokeAccess](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/revokeaccess?view=dataverse-latest)
  for zero masks: `Target` identifies the view and `Revokee` identifies the
  user/team.

The service validates GUIDs, principal types and supported masks before sending
mutations. Dataverse enforces authorization.

Writes are sequential, not transactional. Each successful write updates the
local saved state and removes only that pending edit. A failure stops the batch
and keeps the remaining edits for retry. After all writes succeed, the model
reloads sharing records. A reload failure is reported separately from a write
failure so users are not told that successful changes failed to save.

The model reports whether a save and reload completed for the current view.
Only a confirmed result triggers the composition root's ToolBox success
notification; no-op or stale saves do not. The unsaved-changes prompt is rendered
below the access grid.

## State and error handling

- Request counters prevent stale view/access responses from replacing newer
  state.
- Changing owner or refreshing clears selected-view access.
- Pending edits and active saves disable owner/view navigation and refresh.
- Connection resets clear local edits. An already submitted write cannot be
  cancelled, but the save flow checks the request generation before submitting
  another write or updating the screen.
- API failures use the injected `onLog` callback with operation context and
  error severity. Failed FetchXML calls also include the exact query.
- Errors propagate to the screen's notifications and message bars. A successful
  API call is not logged as a failed fetch.

## Build and validate

Install dependencies for a fresh checkout:

```powershell
npm install
```

Build and type-check:

```powershell
npm run build
```

[vite.config.ts](vite.config.ts) generates an IIFE bundle and moves its script
to the end of the HTML body for PPTB compatibility. The package entry point is
`dist/index.html`. The existing large-bundle warning is non-blocking.

For local development inside PPTB:

```powershell
npm run watch
```

Use PPTB's local-tool loading workflow with the project root, then reload the
tool tab after rebuilding. **Do not attempt standalone browser previews,
browser automation, screenshots or mocked-host rendering.** Rendering and live
Dataverse integration must be checked inside PPTB.

Before publishing, supply the required repository/readme URL manifest settings
and run the PPTB validator:

```powershell
npx pptb-validate --skip-url-checks
```

## Tests

Run the service/view-model regression tests without the PPTB host:

```powershell
node --test tests\viewAccess.test.cjs
```

[viewAccess.test.cjs](tests/viewAccess.test.cjs) uses Node's built-in test runner
and the existing TypeScript dependency to load model/service code without
rendering UI. Coverage includes all 256 documented mask combinations, user/team
action payloads, mutation validation/logging, staging/discard, successful saves,
partial-failure retries, reload failures, duplicate-save protection and
connection-reset handling. Run the build as well for full TypeScript checking.
