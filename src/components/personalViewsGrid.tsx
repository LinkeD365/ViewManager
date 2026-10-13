import React, { useEffect, useRef } from "react";
import { makeStyles } from "@fluentui/react-components";
import { AllCommunityModule, themeQuartz } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { PersonalView, PersonalViewsGridProps } from "../model/viewModel";

const useStyles = makeStyles({
  grid: {
    flex: 1,
    minHeight: "320px",
    minWidth: 0,
  },
});

const columns: ColDef<PersonalView>[] = [
  { field: "name", headerName: "View name", minWidth: 220, flex: 1, initialSort: "asc", initialSortIndex: 1 },
  { field: "tableName", headerName: "Table", minWidth: 200, initialSort: "asc", initialSortIndex: 0 },
  { field: "ownerName", headerName: "Owner", minWidth: 180 },
  {
    field: "modifiedOn",
    headerName: "Modified",
    minWidth: 180,
    valueFormatter: ({ value }) => value ? new Date(value).toLocaleString() : "",
  },
  { field: "description", headerName: "Description", minWidth: 220, flex: 1 },
];

export const PersonalViewsGrid = ({ views, selectedViewIds, onSelectViews, selectionDisabled }: PersonalViewsGridProps): React.JSX.Element => {
  const styles = useStyles();
  const grid = useRef<AgGridReact<PersonalView>>(null);
  const syncingSelection = useRef(false);
  useEffect(() => {
    const selected = new Set(selectedViewIds);
    syncingSelection.current = true;
    try {
      grid.current?.api?.forEachNode((node) => {
        const shouldSelect = !!node.id && selected.has(node.id);
        if (node.isSelected() !== shouldSelect) node.setSelected(shouldSelect);
      });
    } finally {
      syncingSelection.current = false;
    }
  }, [selectedViewIds, views]);
  return (
    <div className={styles.grid}>
      <AgGridReact<PersonalView>
        ref={grid}
        modules={[AllCommunityModule]}
        onGridReady={({ api }) => api.setGridAriaProperty("label", "Personal views")}
        theme={themeQuartz}
        rowData={views}
        columnDefs={columns}
        getRowId={({ data }) => data.id}
        defaultColDef={{ sortable: true, filter: true, resizable: true, suppressKeyboardEvent: () => selectionDisabled }}
        rowSelection={{
          mode: "multiRow",
          checkboxes: () => !selectionDisabled,
          headerCheckbox: !selectionDisabled,
          selectAll: "filtered",
          enableClickSelection: !selectionDisabled,
        }}
        onSelectionChanged={(event) => {
          if (selectionDisabled || syncingSelection.current) return;
          void onSelectViews(event.api.getSelectedRows());
        }}
        pagination
        paginationPageSize={25}
        overlayNoRowsTemplate="No personal views found."
      />
    </div>
  );
};
