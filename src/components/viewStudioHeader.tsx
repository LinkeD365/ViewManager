import React, { useState } from "react";
import { observer } from "mobx-react";
import { Combobox, makeStyles, Option, tokens, Toolbar, ToolbarButton, Tooltip } from "@fluentui/react-components";
import { ArrowClockwise24Regular, Copy24Regular, PersonAdd24Regular, PersonSwap24Regular } from "@fluentui/react-icons";
import type { ViewStudioHeaderProps } from "../model/viewModel";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    position: "relative",
    zIndex: 10,
  },
  actions: {
    marginLeft: "auto",
  },
});

export const ViewStudioHeader = observer((props: ViewStudioHeaderProps): React.JSX.Element => {
  const {
    activeUsers, selectedOwnerId, tables, selectedTableLogicalName, tableDisabled,
    ownerDisabled, refreshDisabled, onOwnerChange, onTableChange, onRefresh,
    changeOwnerDisabled, selectedViewCount, onChangeOwner,
    addUsersDisabled, onAddUsers, copyViewsDisabled, onCopyViews,
  } = props;
  const styles = useStyles();
  const [ownerSearch, setOwnerSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const visibleTables = tables.filter((table) =>
    table.name.toLocaleLowerCase().includes(tableSearch.toLocaleLowerCase()),
  );
  const selectedTableName = tables.find((table) => table.logicalName === selectedTableLogicalName)?.name ?? "";
  const visibleUsers = activeUsers.filter((user) =>
    user.name.toLocaleLowerCase().includes(ownerSearch.toLocaleLowerCase()),
  );
  const selectedOwnerName = selectedOwnerId === null
    ? "All owners"
    : activeUsers.find((user) => user.id === selectedOwnerId)?.name ?? "";

  return (
    <div className={styles.header}>
      <Combobox
        aria-label="Filter views by owner"
        placeholder="Select an owner"
        inlinePopup
        value={ownerSearch || selectedOwnerName}
        selectedOptions={[selectedOwnerId ?? "all"]}
        onChange={(event) => setOwnerSearch(event.target.value)}
        onOptionSelect={(_event, data) => {
          const ownerId = data.optionValue === "all" ? null : data.optionValue ?? null;
          onOwnerChange(ownerId);
          setOwnerSearch("");
          setTableSearch("");
        }}
        disabled={ownerDisabled}
      >
        <Option value="all">All owners</Option>
        {visibleUsers.map((user) => (
          <Option key={user.id} value={user.id} text={user.name}>
            {user.name}{user.isCurrentUser ? " (You)" : ""}
          </Option>
        ))}
        {visibleUsers.length === 0 && ownerSearch && (
          <Option value="no-matches" text="No matching users" disabled>
            No matching users
          </Option>
        )}
      </Combobox>
      <Combobox
        aria-label="Filter views by table"
        placeholder="Select a table"
        inlinePopup
        value={tableSearch || selectedTableName}
        selectedOptions={selectedTableLogicalName ? [selectedTableLogicalName] : []}
        onChange={(event) => setTableSearch(event.target.value)}
        onOptionSelect={(_event, data) => {
          if (!data.optionValue) return;
          onTableChange(data.optionValue);
          setTableSearch("");
        }}
        disabled={selectedOwnerId !== null || tableDisabled}
      >
        {visibleTables.map((table) => (
          <Option key={table.logicalName} value={table.logicalName} text={table.name}>
            {table.name}
          </Option>
        ))}
        {visibleTables.length === 0 && (
          <Option value="no-matches" text="No matching tables" disabled>
            No matching tables
          </Option>
        )}
      </Combobox>
      <Toolbar className={styles.actions} aria-label="Personal views actions">
        <Tooltip content={`Copy to system views (${selectedViewCount})`} relationship="label">
          <ToolbarButton
            aria-label={`Copy to system views (${selectedViewCount})`}
            icon={<Copy24Regular />}
            disabled={copyViewsDisabled}
            onClick={onCopyViews}
          />
        </Tooltip>
        <Tooltip content={`Add users (${selectedViewCount})`} relationship="label">
          <ToolbarButton
            aria-label={`Add users (${selectedViewCount})`}
            icon={<PersonAdd24Regular />}
            disabled={addUsersDisabled}
            onClick={onAddUsers}
          />
        </Tooltip>
        <Tooltip content={`Change owner (${selectedViewCount})`} relationship="label">
          <ToolbarButton
            aria-label={`Change owner (${selectedViewCount})`}
            icon={<PersonSwap24Regular />}
            disabled={changeOwnerDisabled}
            onClick={onChangeOwner}
          />
        </Tooltip>
        <Tooltip content="Refresh personal views" relationship="label">
          <ToolbarButton
            aria-label="Refresh personal views"
            icon={<ArrowClockwise24Regular />}
            disabled={refreshDisabled}
            onClick={() => void onRefresh()}
          />
        </Tooltip>
      </Toolbar>
    </div>
  );
});
