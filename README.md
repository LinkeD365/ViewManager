# ViewStudio

ViewStudio is a Power Platform ToolBox tool for browsing Dataverse personal
views and managing the users and teams they are shared with.

## Getting started

1. Open Power Platform ToolBox and connect to your Dataverse environment.
2. Open ViewStudio inside ToolBox.
3. Use the owner filter to find personal views.
4. Select a view to see its sharing permissions.

ViewStudio requires the ToolBox host and does not run as a standalone website.
The connected account must have permission to read the relevant views and
sharing records, and to change sharing if you want to edit access.

## Find personal views

The owner filter defaults to the current user. Type in the filter to search for
another available user, or select **All owners** to remove the owner filter.
Results are still limited by the connected account's permissions.

The left-hand grid shows each view's name, table, owner, last modified date and
description. It starts sorted by **Table**, then **View name**. You can change
sorting, filter columns and browse results using the pagination controls.

Use the **Refresh personal views** icon beside the owner filter to reload the
list. Changing owner or refreshing clears the selected view and access panel.

## See who a view is shared with

Select a row in the left-hand grid. The right-hand panel displays the users and
teams returned for that view, together with readable access rights such as
**Read**, **Write** and **Share**.

- The panel lists sharing records, not everyone who could access the view.
- Team members are not expanded into individual users.
- Ownership, security roles or membership of other teams may provide additional
  access that is not shown here.
- A warning appears when the query reaches its limit of **51 sharing records**;
  more records may exist.

## Change access rights

1. Click a user's or team's **Access rights** value.
2. In the editor, open the multi-select list and select or clear permissions.
3. Select **Done** to return to the access panel. This does **not** save yet.
4. Repeat for other users or teams if needed.
5. Click the **Save access changes** icon in the access-panel header to save all
   pending edits for the selected view.

Use the **Discard access changes** icon to undo pending edits instead. The owner
filter, view selection and refresh are disabled while edits are pending or
saving, to prevent accidental loss of changes.

The picker offers **Read**, **Write**, **Delete**, **Share** and **Assign**.
Create, Append and Append to are hidden from the picker; any existing grants for
those permissions are preserved.

**Saving with no remaining permissions revokes that user's or team's share.**
Clearing the picker does not remove hidden permissions. Users may also still
have access through ownership, roles or other teams.

The panel reloads after saving and displays a confirmation. Unsupported
permissions appear as **Unknown rights** and cannot be edited in this tool.

### If saving fails

The tool displays an error and retains edits that have not been saved. Changes
are saved one user or team at a time, so earlier changes may already have
succeeded. Check the message, then retry **Save** or discard the remaining edits.

If saving succeeds but reloading fails, the message explains that the changes
were saved. Refresh the personal views and select the view again to reload its
sharing records.

## Troubleshooting

- **No connection:** select an active Dataverse connection in ToolBox.
- **No views:** check the selected owner and any grid filters, or try All owners.
- **No sharing records:** the selected view may have no returned shares; this
  does not mean nobody can access it.
- **Access denied:** check that the connected account has the required
  permissions. Editing the filter does not change which account makes requests.
- **Controls disabled:** finish saving or discard pending permission changes.

## Technical documentation

For architecture, Dataverse APIs, local builds, testing and implementation
details, see [Technical implementation](IMPLEMENTATION.md).

## License

MIT
