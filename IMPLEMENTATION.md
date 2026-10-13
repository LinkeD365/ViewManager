# ViewStudio technical implementation

For application usage, see the [ViewStudio user guide](README.md).

## Stack and host

ViewStudio uses React 18, TypeScript, Fluent UI v9, MobX and AG Grid Community.
It runs inside Power Platform ToolBox (PPTB), which supplies `toolboxAPI` and
`dataverseAPI`. Dataverse requests use the host API, not manually managed access
tokens.

## Architecture

- [App.tsx](src/App.tsx) obtains all configured connection slots and the theme,
  constructs one targeted service per assigned slot, and supplies logging and
  notification callbacks.
- [viewModel.tsx](src/model/viewModel.tsx) owns application state, all application
  interfaces, the `ViewDataService` contract and access-rights definitions.
  It does not depend on the concrete Dataverse service.
- [copySystemViewsModel.tsx](src/model/copySystemViewsModel.tsx) is the focused
  observable copy-workflow collaborator owned by `ViewModel`. It tracks solution
  loading, stable copy IDs, progress, retries and request invalidation.
- [copySystemViewsToPersonalModel.tsx](src/model/copySystemViewsToPersonalModel.tsx)
  handles system-to-personal batch copies, including owner locking, stable-ID
  recovery and invalidating pending operations when the connection changes.
- [crossEnvironmentCopyModel.tsx](src/model/crossEnvironmentCopyModel.tsx)
  handles same-type personal/system copies from primary to selected connection
  slots, with per-destination owners/solutions, stable IDs and partial retries.
- [dataverseService.tsx](src/services/dataverseService.tsx) implements that
  contract, constructs requests, maps responses and logs API failures.
- [viewStudio.tsx](src/components/viewStudio.tsx) coordinates loading, user
  actions, the Personal/System tabs and the personal-view two-panel layout.

Distinct UI areas are separate controls with focused display-data and callback
props:

| Control | Responsibility |
| --- | --- |
| [ViewStudioHeader](src/components/viewStudioHeader.tsx) | Searchable owner/table filters and refresh action |
| [PersonalViewsGrid](src/components/personalViewsGrid.tsx) | View columns, sorting, pagination and selection |
| [SystemViews](src/components/systemViews.tsx) | Table-first system-view selection, refresh and copy action |
| [ViewOwnerDialog](src/components/viewOwnerDialog.tsx) | Searchable new-owner selection and assignment confirmation |
| [AddViewUsersDialog](src/components/addViewUsersDialog.tsx) | Multi-user selection, shared permission selection and replacement warning |
| [CopySystemViewsDialog](src/components/copySystemViewsDialog.tsx) | Searchable unmanaged-solution selection, public-view warning, copy progress and retry |
| [CopySystemViewToPersonalDialog](src/components/copySystemViewToPersonalDialog.tsx) | Private-copy confirmation, create progress and retry |
| [CrossEnvironmentCopyDialog](src/components/crossEnvironmentCopyDialog.tsx) | Multi-destination selection, per-environment owner/solution selection and copy progress |
| [ViewAccessPanel](src/components/viewAccessPanel.tsx) | Sharing records, save/discard actions and status |
| [ViewAccessEditor](src/components/viewAccessEditor.tsx) | Compact permission multi-select list box in a dialog |
| [ViewAccessUserPicker](src/components/viewAccessUserPicker.tsx) | Searchable user selection for a new access row |

Controls do not call Dataverse directly. Their interfaces remain in the
view-model module. Fluent dropdowns use `inlinePopup`; the header's positioned
stacking layer keeps its owner picker above the grids.
The owner and table filters are left-aligned, with refresh aligned to the right.
The table combobox stays visible but is disabled when a specific owner is selected.
Grid sort-priority numbers are hidden via the scoped `.ag-sort-order` rule in
`src/index.css`; sort arrows and multi-column sorting remain unchanged.
Text columns in both view grids use case-insensitive sorting.

The root `FluentProvider` sets `applyStylesToPortals={false}` so its full-screen
layout classes are not copied to tooltip/dialog portal containers. Theme tokens
are still provided, and tooltips use Fluent's default mounting behavior without
per-control `document.body` overrides.

## Reading Dataverse data

| Purpose | API/query |
| --- | --- |
| Available owners | FetchXML on `systemuser`, ordered by full name |
| Current user | `execute` with the `WhoAmI` function |
| Personal views | FetchXML on `userquery`, filtered by owner or by `returnedtypecode` for All owners |
| System views | FetchXML on `savedquery`, filtered by the selected table's numeric `returnedtypecode` and excluding `querytype = 8192` |
| Copy destination solutions | FetchXML on visible unmanaged `solution` records, excluding internal Active/Default solutions |
| Copy source definition | `retrieve("userquery", id, columns)` for name, table, FetchXML and layout fields |
| Personal-copy source definition | `retrieve("savedquery", id, columns)` for name, table, FetchXML and layout fields |
| Table picker, display names and type codes | `getAllEntitiesMetadata(["LogicalName", "DisplayName", "ObjectTypeCode"])` |
| View sharing | FetchXML on `principalobjectaccess`, filtered by selected view ID |

The owner query requires `isdisabled = 0`, `applicationid` null and
`systemmanagedusertype = 0`, and excludes access modes `3` and `5`.

Table names display as `Display Name (logicalname)`. The service caches the
metadata promise so overlapping requests share one load. Failed metadata loads
clear the cache for retry. A new service instance gets a new cache when the
connection changes.

All owners requires a table selection before fetching views or showing the grid.
The searchable table picker loads every table from metadata, including tables
without personal views, sorts by display/logical name and reuses the display-name
cache. The model tracks table loading/errors and ignores stale metadata responses
after a connection reset. Refresh retries a failed table load. Choosing a specific
owner clears the table selection and restores owner-only filtering across tables.
The service resolves the selected logical name to its metadata `ObjectTypeCode`
and uses that numeric value in the `returnedtypecode` condition. Missing or invalid
codes are logged and reported without submitting a view query.

The model defaults to the Personal views tab. Small Fluent tabs provide the
screen titles without duplicate headings above the filters. Labelled tabpanels
keep the two screens mounted so personal filters, selection and grid state are
preserved when switching. Pending edits, active saves and bulk dialogs lock tab
switching. System views have a separate table selection, result list, request
generation, loading state and error, while sharing the metadata cache and table
list with personal views. Selecting a system table or refreshing invokes
`getSystemViews`; no system query is made without a table. The service reuses the
numeric object-type-code validation used by personal views. System queries read
view IDs, names, modified dates and descriptions, without ownership or sharing
operations. Table changes invalidate stale responses; connection changes and
unmount clear the system selection and invalidate pending reads. System-table
metadata errors support retry via the system Refresh action. The system grid
allows multiple selected rows; selection is cleared on table changes and
refreshes. Its toolbar copy action is enabled only when one or more views are
selected and no other edit or copy operation locks navigation.

The sharing query uses object type `4230`, principal types `8` and `9`, outer
joins to `systemuser` and `team`, `distinct`, `latematerialize`, a union filter
hint and `top="51"`. Response mapping accepts both numeric principal types and
the logical names `systemuser` and `team`. The UI warns when 51 rows are returned;
it does not page beyond that limit.

These are sharing records, not a complete effective-access calculation.

## Copying personal views to system views

The icon-only header action requires one or more selected personal views and no
loading/navigation locks. `ViewModel.beginCopySystemViews` validates that the
selection belongs to the current listing, then gives a snapshot to
`CopySystemViewsModel`. The dialog locks navigation while open. Its searchable
solution picker displays friendly name, unique name and version, with explicit
loading, error/retry and empty states. The service filters `ismanaged = false`,
`isvisible = true` and excludes internal `Active`/`Default` solutions. Response
flags and required fields are validated. Each submission rechecks that the
chosen unmanaged solution is still available before copying.

For each source view, the workflow:

1. Allocates a stable destination GUID for the lifetime of the form and checks
   for that exact `savedqueryid`, allowing recovery if a create response was lost.
2. Retrieves the source definition if no copy exists. Required fields are
   `name`, `returnedtypecode`, `fetchxml` and `layoutxml`. Optional description,
   column-set XML, layout JSON, conditional formatting and advanced grouping
   are preserved; source IDs and ownership are not copied. Numeric source type
   codes are resolved through cached metadata to a logical table name.
3. Calls `create("savedquery", ...)` with that GUID, the definition, `querytype: 0`
   (public view) and `isdefault: false`. Creation uses the table's **logical name**
   for `returnedtypecode`, unlike the numeric FetchXML listing filters.
4. Calls the unbound `AddSolutionComponent` action with `ComponentType: 26`,
   the destination `ComponentId`, `SolutionUniqueName`, `AddRequiredComponents:
   false` and `DoNotIncludeSubcomponents: true`.

Processing is sequential and stops on the first error. Each target separately
tracks creation and solution membership. Retries retain the destination GUID,
definition and solution; completed targets are skipped and a created-but-not-added
view is only added to the solution. Stable primary keys prevent duplicate records
even if a creation response is lost. The solution is locked once copying starts.
The form reports partial progress and created-but-not-added IDs and warns that
closing does not roll back server changes. Retry state is in-memory only.

Original personal views, permissions and selection are unchanged. The screen
refreshes the selected system table after successful copying or closing an
attempted batch. Refresh errors remain system-list errors, not failed-copy
retries. No publish action runs: the form explains public-view visibility and
asks users to review/publish through their solution as needed.

Duplicate submissions and cancellation during writes are blocked. Connection
changes and unmount reset the collaborator and invalidate pending work. Generation
checks after every awaited service step prevent further writes or stale UI updates.
Already submitted writes cannot be cancelled. All service errors are logged with
operation context and surfaced through notifications and the dialog.

## Copying system views to personal views

The System views grid permits multiple selected system views. Its copy dialog
requires selecting an active user as the new owner; it does not modify or share
the source system views. There is no solution-picker or publish step for this
direction. The chosen owner is locked on the first attempt so partial retries
cannot produce a mixed-owner batch.

For each source, the workflow allocates a stable `userqueryid`, checks that exact
ID with `personalViewExists`, retrieves the source using
`getSystemViewDefinition`, and creates `userquery` with the source's required and
supported optional query/layout fields, `querytype: 0` and
`ownerid@odata.bind` for the selected system user. Numeric table type codes are
converted to logical names using the shared metadata cache. Source IDs and
ownership are not copied.

For system-view copies, the service logs the exact `retrieve("savedquery", id,
columns)` request and a safe response summary to the PPTB event log. The summary
includes each required field's type and, for strings, character count and whether
it is blank; it does not log the XML contents. Validation errors identify the
specific missing or blank required fields.

If create fails or its response is lost, the dialog remains open with the same
ID. Retry first checks for that userquery, preventing a duplicate after a lost
response. Copies run sequentially with per-view progress. Retry skips completed
views and retains stable IDs and the locked owner. Cancel/close does not roll back
a submitted write; after a failed attempt, the matching selected-owner or
all-owner personal-view listing is refreshed when it can show a possibly created
view. Connection changes and unmount reset the copy collaborator and invalidate
pending requests. On success, the matching listing is refreshed as well.

## Copying views across environments

The manifest allows 1–10 connection slots. `useConnection` retains the host's
slot array, including empty slots, and `App` creates a Dataverse service for
each assigned slot using that numeric slot as `connectionTarget`. Slot 0 is
always the source; configured slots 1–9 are offered as destinations. The
service routes FetchXML, execute, retrieve, create and metadata calls through
the same slot-specific target.

The cross-environment dialog supports personal-to-personal and
system-to-system copies. Users select one or more configured destination slots;
active users or unmanaged solutions are loaded independently from each selected
destination. The source definition is always read from slot 0. Existence checks,
creates, and solution-component additions are sent through each destination's
service. Each source/destination pair has a stable new ID and independent
progress. For personal views, the new owner is selected per destination; for
system views, the unmanaged solution is selected per destination.

Destinations and per-environment settings lock before the first write and stay
fixed through retries. Completed pairs are skipped; a system view created before
a failed solution addition is only added on retry. Connection changes and
unmount invalidate pending requests and clear the in-memory operation; submitted
Dataverse writes cannot be cancelled. The model rejects unknown destination
slots and verifies each selected service is still available.

The focused `crossEnvironmentCopy.test.cjs` suite covers multiple destination
slots, destination-specific settings, partial retries with stable IDs, and
numeric connection routing through slot 9.

## View ownership

The listing uses multi-row checkbox selection and a filtered select-all checkbox
that includes matching rows across pages. Row selection is tracked separately
from the single view shown in the access panel. Zero or multiple selections clear
the access panel and invalidate pending access reads. Selection resets when
filters, connection or loaded views change.

The header Change owner action is enabled for one or more selected views,
with no loading/navigation locks. The per-row action is removed. The dialog
captures the selected views. Candidates reuse the active-user list, excluding
users who already own every selected view by case-insensitive ID.
The service validates both GUIDs and calls the
unbound `Assign` action with a typed `userquery` Target and `systemuser` Assignee.
Dataverse enforces assignment privileges.

Pending access edits and active saves block assignment. While the owner dialog
is open, owner/table filters, view navigation and refresh are locked. An
in-flight assignment cannot be submitted twice or cancelled. Assignments run
sequentially, skipping views already owned by the chosen user. Each completed
view is removed from the pending batch and its local row updated or removed to
match the filter. Processing stops at the first failure and shows counts plus
the failed view (or the friendly read-role error). Once any view is completed,
the owner is locked so retries apply only the remaining assignments to that same
user. Closing a partial batch does not undo completed assignments. Success clears
row/sharing selection and reloads the current owner/table query once.
Reload failures explicitly report that
ownership was already changed and unlock Refresh instead of offering another
assignment. Request generations suppress stale results, notifications and
follow-up reads after connection changes or unmount; submitted writes cannot
be cancelled.

Service/model tests cover Assign payloads and validation, navigation locks,
cancel/retry, filter refresh, partial success, duplicate submission and stale
assignment/reload results.

Assignment errors identifying `prvReadUserQuery` together with `0x80042f09` or
the missing-role message show a friendly user-view read-access explanation in
the dialog and notification. The service retains the original diagnostic in its
error log. Other privileges and post-assignment reload failures are not remapped.

## Bulk user access

The top-bar Add users icon uses the same selection/loading/navigation gate as
Change owner. Its modal snapshots the selected views and lets the user select
multiple active users plus one nonzero mask from the existing permission picker
options. Read is the default. An explicit warning explains that existing direct
sharing permissions, including hidden rights, are replaced rather than merged.

The model builds the selected views/users cross-product, deduplicating user IDs
case-insensitively. For each pair, `getUserViewAccessMask` reads the exact
`principalobjectaccess` row using object ID, user ID, object type `4230` and
principal type `8`. This targeted lookup is independent of the access panel's
51-row limit. Missing direct shares or zero direct masks use `GrantAccess`;
existing nonzero masks use `ModifyAccess` with exactly the chosen mask.
Inherited masks are not used. Lookup failures are logged and abort the batch,
never interpreted as a missing share.

Writes are sequential and successful pairs are removed from the pending queue.
Failures report the user/view and progress, and retries keep the original
users/mask and apply only unfinished changes. Closing partial work does not
revoke successful grants or restore replaced permissions. The grid selection is
cleared on the first successful write to avoid stale sharing details. Completion
reloads the original owner/table query once; reload errors explicitly distinguish
saved permissions from failed writes. Connection changes/unmount invalidate the
batch before subsequent reads or writes, including between a sharing lookup and
its mutation. An already-submitted API operation cannot be cancelled.

Service/model tests cover exact user/view queries, mask validation, new/existing
shares, replacement rather than union, the full cross-product, duplicate users,
partial retry, navigation locks, reload failure and stale lookup/write responses.

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
- Changing owner, table or refreshing clears selected-view access.
- Pending edits and active saves disable owner/table/view navigation and refresh.
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
npm test
```

The suites use Node's built-in test runner and share the TypeScript loader,
fixtures and fake-service/model factories in [helpers.cjs](tests/helpers.cjs).
Tests run without rendering UI. `npm test` runs `node --test`; use the direct
Node command for focused suites.

| Suite | Coverage |
| --- | --- |
| [accessRights.test.cjs](tests/accessRights.test.cjs) | All 256 mask combinations, permission picker, mutation validation and action payloads |
| [viewAccess.test.cjs](tests/viewAccess.test.cjs) | Staging/discard, saves, retries, navigation locks and stale responses |
| [viewAccessUsers.test.cjs](tests/viewAccessUsers.test.cjs) | Adding, removing and re-adding users to a view's access panel |
| [bulkViewAccess.test.cjs](tests/bulkViewAccess.test.cjs) | Direct-share lookups, bulk replacement, partial retries and connection changes |
| [viewOwnership.test.cjs](tests/viewOwnership.test.cjs) | Assign payloads, friendly errors, owner dialog and assignment lifecycle |
| [bulkViewOwnership.test.cjs](tests/bulkViewOwnership.test.cjs) | Multi-selection, bulk assignment, mixed owners and partial retries |
| [viewFiltering.test.cjs](tests/viewFiltering.test.cjs) | Owner/table filters, metadata caching, numeric type codes and stale requests |
| [systemViews.test.cjs](tests/systemViews.test.cjs) | Tab state/locks, table-first loading, saved-query requests, errors and stale responses |
| [systemViewCopyService.test.cjs](tests/systemViewCopyService.test.cjs) | Unmanaged solutions, definition validation, stable-ID creation, solution-component payloads and logging |
| [systemViewCopy.test.cjs](tests/systemViewCopy.test.cjs) | Selection gates, solution loading, sequential copying, partial retries and lost create responses |
| [systemViewCopyLifecycle.test.cjs](tests/systemViewCopyLifecycle.test.cjs) | Duplicate submissions, cancellation, read failures and connection/unmount invalidation at every copy stage |
| [personalViewCopy.test.cjs](tests/personalViewCopy.test.cjs) | Saved-query definition reads, userquery creation/existence checks, stable-ID retries and invalidation |
| [crossEnvironmentCopy.test.cjs](tests/crossEnvironmentCopy.test.cjs) | Multi-destination copies, per-environment settings, partial retries and slot routing |

To run a focused suite, pass its path, for example:

```powershell
node --test tests\bulkViewAccess.test.cjs
node --test tests\systemViewCopy.test.cjs tests\systemViewCopyService.test.cjs tests\systemViewCopyLifecycle.test.cjs
node --test tests\crossEnvironmentCopy.test.cjs
```

Run the build as well when changing application code for full TypeScript checking.

## Repository safeguards and releases

Pull requests and pushes to `main` run the CI workflow, which installs from the
lockfile and checks the build, PPTB package manifest and test suites. The
required check is named **Build and test**. Dependabot checks npm dependencies
and GitHub Actions weekly. Actions used by the workflows are pinned to commit
SHAs, and the CODEOWNERS file requests review from `@LinkeD365`.

GitHub does not apply branch protection from files in the repository. In the
repository's branch rules for `main`, require pull requests, at least one
approval, approval from code owners, dismissal of stale approvals, conversation
resolution and the **Build and test** status check; block force pushes and
deletion, and apply the rules to administrators. These settings must be enabled
by a repository administrator.

Releases follow the Release Please structure used by
[PPTB-EnvManager](https://github.com/LinkeD365/PPTB-EnvManager). Conventional
commit messages drive the release PR and generated [CHANGELOG.md](CHANGELOG.md).
Merging that PR creates a version tag; the release workflow builds the tag and
publishes it to npm with provenance using GitHub's OIDC identity. Before the
first publish, configure npm trusted publishing for `LinkeD365/ViewStudio`,
workflow `.github/workflows/release.yml`, and the GitHub `npm` environment.
