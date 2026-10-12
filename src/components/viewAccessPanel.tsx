import React, { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Button, makeStyles, MessageBar, Spinner, Text, Toolbar, ToolbarButton, Tooltip, tokens } from "@fluentui/react-components";
import { Add24Regular, ArrowUndo24Regular, Delete24Regular, Save24Regular } from "@fluentui/react-icons";
import { AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { formatAccessRights } from "../model/viewModel";
import type { ViewAccessGridRow, ViewAccessPanelProps } from "../model/viewModel";
import { ViewAccessEditor } from "./viewAccessEditor";
import { ViewAccessUserPicker } from "./viewAccessUserPicker";

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    minWidth: 0,
  },
  grid: {
    flex: 1,
    minHeight: "320px",
    minWidth: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rightsButton: {
    whiteSpace: "normal",
    textAlign: "left",
    justifyContent: "flex-start",
  },
});

export const ViewAccessPanel = observer((props: ViewAccessPanelProps): React.JSX.Element => {
  const { selectedView, access, isLoading, error, hasChanges, isSaving, saveError, onChange, onRemove, onSave, onDiscard,
    availableUsers, hasNewUserRow, onAddUser, onSelectUser, onCancelUser } = props;
  const styles = useStyles();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const editingPrincipal = access.find((entry) => `${entry.principalType}:${entry.id}` === editingKey);
  const columns = useMemo<ColDef<ViewAccessGridRow>[]>(() => [
    {
      field: "name", headerName: "Name", minWidth: 180, flex: 1, initialSort: "asc",
      cellRenderer: ({ data, value }: ICellRendererParams<ViewAccessGridRow, string>) =>
        data && "isNewUserRow" in data
          ? <Button appearance="transparent" onClick={() => setShowUserPicker(true)}>Select a user...</Button>
          : value,
    },
    { field: "principalType", headerName: "Type", width: 100 },
    {
      colId: "accessRights",
      headerName: "Access rights",
      minWidth: 220,
      flex: 1,
      wrapText: true,
      autoHeight: true,
      valueGetter: ({ data }) => data && !("isNewUserRow" in data) ? formatAccessRights(data.accessRightsMask) : "",
      tooltipValueGetter: ({ data }) => data && !("isNewUserRow" in data) ? `Access rights mask: ${data.accessRightsMask}` : "",
      cellRenderer: ({ data, value }: ICellRendererParams<ViewAccessGridRow, string>) => data && !("isNewUserRow" in data) ? (
        <Button
          appearance="transparent"
          className={styles.rightsButton}
          disabled={isSaving}
          aria-label={`Edit access rights for ${data.name}`}
          onClick={() => setEditingKey(`${data.principalType}:${data.id}`)}
        >
          {value}
        </Button>
      ) : null,
    },
    {
      colId: "actions",
      headerName: "",
      width: 90,
      pinned: "right",
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: ({ data }: ICellRendererParams<ViewAccessGridRow>) =>
        data && !("isNewUserRow" in data) && data.principalType === "User" ? (
          <Tooltip content="Remove user access (apply with Save)" relationship="label">
            <Button
              appearance="transparent"
              icon={<Delete24Regular />}
              aria-label={`Remove access for ${data.name}`}
              disabled={isSaving || data.accessRightsMask === 0}
              onClick={() => onRemove(data)}
            />
          </Tooltip>
        ) : null,
    },
  ], [isSaving, onRemove, styles.rightsButton]);
  return (
    <section className={styles.panel} aria-label="Selected view access">
      <div className={styles.header}>
        <Text as="h2" size={400} weight="semibold">
          Users and teams with access{selectedView ? ` - ${selectedView.name}` : ""}
        </Text>
        <Toolbar aria-label="View access actions">
          <Tooltip content="Add user" relationship="label">
            <ToolbarButton
              aria-label="Add user"
              icon={<Add24Regular />}
              disabled={!selectedView || isLoading || !!error || isSaving || hasNewUserRow || availableUsers.length === 0}
              onClick={() => { if (onAddUser()) setShowUserPicker(true); }}
            />
          </Tooltip>
          {isSaving && <Spinner size="tiny" label="Saving..." labelPosition="before" />}
          <Tooltip content="Save access changes" relationship="label">
            <ToolbarButton
              aria-label="Save access changes"
              icon={<Save24Regular />}
              disabled={!selectedView || !hasChanges || hasNewUserRow || isSaving || isLoading}
              onClick={() => void onSave()}
            />
          </Tooltip>
          <Tooltip content="Discard access changes" relationship="label">
            <ToolbarButton
              aria-label="Discard access changes"
              icon={<ArrowUndo24Regular />}
              disabled={!hasChanges || isSaving}
              onClick={onDiscard}
            />
          </Tooltip>
        </Toolbar>
      </div>
      {saveError && <MessageBar intent="error">{saveError}</MessageBar>}
      {!selectedView ? (
        <MessageBar>Select a view on the left to see its access records.</MessageBar>
      ) : isLoading ? (
        <Spinner label="Loading view access..." />
      ) : error ? (
        <MessageBar intent="error">{error}</MessageBar>
      ) : (
        <>
          {access.length === 51 && (
            <MessageBar intent="warning">The query limit of 51 records was reached. More access records may exist.</MessageBar>
          )}
          <div className={styles.grid}>
            <AgGridReact<ViewAccessGridRow>
              modules={[AllCommunityModule]}
              onGridReady={({ api }) => api.setGridAriaProperty("label", "Users and teams with access")}
              theme={themeQuartz}
              rowData={access}
              pinnedBottomRowData={hasNewUserRow ? [{ isNewUserRow: true }] : []}
              suppressNoRowsOverlay={hasNewUserRow}
              columnDefs={columns}
              getRowId={({ data }) => "isNewUserRow" in data ? "new-user-row" : `${data.principalType}:${data.id}`}
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
              overlayNoRowsTemplate="No sharing records found for this view."
            />
          </div>
        </>
      )}
      {hasChanges && <MessageBar>Unsaved access changes. Save or discard them before changing view, owner or refreshing.</MessageBar>}
      {hasNewUserRow && showUserPicker && (
        <ViewAccessUserPicker
          users={availableUsers}
          onSelect={onSelectUser}
          onCancel={() => { onCancelUser(); setShowUserPicker(false); }}
        />
      )}
      {editingPrincipal && !isSaving && (
        <ViewAccessEditor
          principal={editingPrincipal}
          onChange={(mask) => onChange(editingPrincipal, mask)}
          onClose={() => setEditingKey(null)}
        />
      )}
    </section>
  );
});
