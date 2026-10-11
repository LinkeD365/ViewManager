import React, { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Button, makeStyles, MessageBar, Spinner, Text, Toolbar, ToolbarButton, Tooltip, tokens } from "@fluentui/react-components";
import { ArrowUndo24Regular, Save24Regular } from "@fluentui/react-icons";
import { AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { formatAccessRights } from "../model/viewModel";
import type { ViewAccess, ViewAccessPanelProps } from "../model/viewModel";
import { ViewAccessEditor } from "./viewAccessEditor";

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
  const { selectedView, access, isLoading, error, hasChanges, isSaving, saveError, saveMessage, onChange, onSave, onDiscard } = props;
  const styles = useStyles();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editingPrincipal = access.find((entry) => `${entry.principalType}:${entry.id}` === editingKey);
  const columns = useMemo<ColDef<ViewAccess>[]>(() => [
    { field: "name", headerName: "Name", minWidth: 180, flex: 1, initialSort: "asc" },
    { field: "principalType", headerName: "Type", width: 100 },
    {
      colId: "accessRights",
      headerName: "Access rights",
      minWidth: 220,
      flex: 1,
      wrapText: true,
      autoHeight: true,
      valueGetter: ({ data }) => data ? formatAccessRights(data.accessRightsMask) : "",
      tooltipValueGetter: ({ data }) => data ? `Access rights mask: ${data.accessRightsMask}` : "",
      cellRenderer: ({ data, value }: ICellRendererParams<ViewAccess, string>) => data ? (
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
  ], [isSaving, styles.rightsButton]);
  return (
    <section className={styles.panel} aria-label="Selected view access">
      <div className={styles.header}>
        <Text as="h2" size={400} weight="semibold">Users and teams with access</Text>
        <Toolbar aria-label="View access actions">
          <Tooltip content="Save access changes" relationship="label" mountNode={document.body} >
            <ToolbarButton
              aria-label="Save access changes"
              icon={<Save24Regular />}
              disabled={!selectedView || !hasChanges || isSaving || isLoading}
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
      {selectedView && <Text>{selectedView.name}</Text>}
      {hasChanges && <MessageBar>Unsaved access changes. Save or discard them before changing view, owner or refreshing.</MessageBar>}
      {isSaving && <Spinner label="Saving access changes..." />}
      {saveError && <MessageBar intent="error">{saveError}</MessageBar>}
      {saveMessage && <MessageBar intent="success">{saveMessage}</MessageBar>}
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
            <AgGridReact<ViewAccess>
              modules={[AllCommunityModule]}
              onGridReady={({ api }) => api.setGridAriaProperty("label", "Users and teams with access")}
              theme={themeQuartz}
              rowData={access}
              columnDefs={columns}
              getRowId={({ data }) => `${data.principalType}:${data.id}`}
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
              overlayNoRowsTemplate="No sharing records found for this view."
            />
          </div>
        </>
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
