import React from "react";
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

export const PersonalViewsGrid = ({ views, onSelectView, selectionDisabled }: PersonalViewsGridProps): React.JSX.Element => {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      <AgGridReact<PersonalView>
        modules={[AllCommunityModule]}
        onGridReady={({ api }) => api.setGridAriaProperty("label", "Personal views")}
        theme={themeQuartz}
        rowData={views}
        columnDefs={columns}
        getRowId={({ data }) => data.id}
        defaultColDef={{ sortable: true, filter: true, resizable: true, suppressKeyboardEvent: () => selectionDisabled }}
        rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: !selectionDisabled }}
        onSelectionChanged={(event) => {
          if (selectionDisabled) return;
          void onSelectView(event.api.getSelectedRows()[0] ?? null);
        }}
        pagination
        paginationPageSize={25}
        overlayNoRowsTemplate="No personal views found."
      />
    </div>
  );
};
