import React, { useEffect, useRef, useState } from "react";
import { Combobox, makeStyles, MessageBar, Option, Spinner, tokens, Toolbar, ToolbarButton, Tooltip } from "@fluentui/react-components";
import { ArrowClockwise24Regular, Copy24Regular, CopyArrowRight24Regular } from "@fluentui/react-icons";
import { AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { SystemView, SystemViewsProps } from "../model/viewModel";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
    position: "relative",
    zIndex: 10,
  },
  actions: { marginLeft: "auto" },
  grid: { flex: 1, minHeight: "400px", minWidth: 0 },
});

const columns: ColDef<SystemView>[] = [
  {
    field: "name",
    headerName: "View name",
    minWidth: 220,
    flex: 1,
    initialSort: "asc",
    comparator: (valueA, valueB) => (valueA ?? "").localeCompare(valueB ?? "", undefined, { sensitivity: "base" }),
  },
  { field: "tableName", headerName: "Table", minWidth: 200 },
  {
    field: "modifiedOn",
    headerName: "Modified",
    minWidth: 180,
    valueFormatter: ({ value }) => value ? new Date(value).toLocaleString() : "",
  },
  { field: "description", headerName: "Description", minWidth: 220, flex: 1 },
];

export const SystemViews = ({
  connected, tables, selectedTableLogicalName, tableDisabled, isLoadingTables, tablesError,
  views, selectedViewIds, isLoadingViews, error, refreshDisabled, copyDisabled, copyToEnvironmentDisabled,
  onTableChange, onSelectViews, onRefresh, onCopyToPersonal, onCopyToEnvironment,
}: SystemViewsProps): React.JSX.Element => {
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const grid = useRef<AgGridReact<SystemView>>(null);
  const syncingSelection = useRef(false);
  const visibleTables = tables.filter((table) => table.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedName = tables.find((table) => table.logicalName === selectedTableLogicalName)?.name ?? "";
  useEffect(() => {
    syncingSelection.current = true;
    try {
      grid.current?.api?.forEachNode((node) => {
        const shouldSelect = !!node.id && selectedViewIds.includes(node.id);
        if (node.isSelected() !== shouldSelect) node.setSelected(shouldSelect);
      });
    } finally {
      syncingSelection.current = false;
    }
  }, [selectedViewIds, views]);
  return (
    <>
      <div className={styles.header}>
        <Combobox
          aria-label="Table for system views"
          placeholder="Select a table"
          inlinePopup
          value={search || selectedName}
          selectedOptions={selectedTableLogicalName ? [selectedTableLogicalName] : []}
          disabled={tableDisabled}
          onChange={(event) => setSearch(event.target.value)}
          onOptionSelect={(_event, data) => {
            if (!data.optionValue) return;
            onTableChange(data.optionValue);
            setSearch("");
          }}
        >
          {visibleTables.map((table) => <Option key={table.logicalName} value={table.logicalName}>{table.name}</Option>)}
          {visibleTables.length === 0 && <Option disabled>No matching tables</Option>}
        </Combobox>
        <Toolbar className={styles.actions} aria-label="System views actions">
          <Tooltip content="Copy selected views to another environment" relationship="label">
            <ToolbarButton
              aria-label="Copy selected views to another environment"
              icon={<CopyArrowRight24Regular />}
              disabled={copyToEnvironmentDisabled}
              onClick={onCopyToEnvironment}
            />
          </Tooltip>
          <Tooltip content="Copy selected system views to personal views" relationship="label">
            <ToolbarButton
              aria-label="Copy selected system views to personal views"
              icon={<Copy24Regular />}
              disabled={copyDisabled}
              onClick={onCopyToPersonal}
            />
          </Tooltip>
          <Tooltip content="Refresh system views" relationship="label">
            <ToolbarButton
              aria-label="Refresh system views"
              icon={<ArrowClockwise24Regular />}
              disabled={refreshDisabled}
              onClick={() => void onRefresh()}
            />
          </Tooltip>
        </Toolbar>
      </div>
      {!connected ? (
        <MessageBar>No active Dataverse connection. Connect to an environment to view system views.</MessageBar>
      ) : tablesError ? (
        <MessageBar intent="error">{tablesError} Use Refresh system views to retry.</MessageBar>
      ) : isLoadingTables ? (
        <Spinner label="Loading tables..." />
      ) : selectedTableLogicalName === null ? (
        <MessageBar>Select a table to show its system views.</MessageBar>
      ) : error ? (
        <MessageBar intent="error">{error}</MessageBar>
      ) : isLoadingViews ? (
        <Spinner label="Loading system views..." />
      ) : (
        <div className={styles.grid}>
          <AgGridReact<SystemView>
            ref={grid}
            modules={[AllCommunityModule]}
            onGridReady={({ api }) => api.setGridAriaProperty("label", "System views")}
            theme={themeQuartz}
            rowData={views}
            columnDefs={columns}
            getRowId={({ data }) => data.id}
            defaultColDef={{ sortable: true, filter: true, resizable: true }}
            rowSelection={{
              mode: "multiRow",
              checkboxes: true,
              headerCheckbox: true,
              selectAll: "filtered",
              enableClickSelection: true,
            }}
            onSelectionChanged={(event) => {
              if (syncingSelection.current) return;
              onSelectViews(event.api.getSelectedRows());
            }}
            pagination
            paginationPageSize={25}
            overlayNoRowsTemplate="No system views found for this table."
          />
        </div>
      )}
    </>
  );
};
