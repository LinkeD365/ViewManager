import React, { useState } from "react";
import { observer } from "mobx-react";
import { Combobox, makeStyles, Option, Text, Toolbar, ToolbarButton } from "@fluentui/react-components";
import { ArrowClockwise24Regular } from "@fluentui/react-icons";
import type { ViewStudioHeaderProps } from "../model/viewModel";

const useStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 10,
  },
});

export const ViewStudioHeader = observer((props: ViewStudioHeaderProps): React.JSX.Element => {
  const { activeUsers, selectedOwnerId, ownerDisabled, refreshDisabled, onOwnerChange, onRefresh } = props;
  const styles = useStyles();
  const [ownerSearch, setOwnerSearch] = useState("");
  const visibleUsers = activeUsers.filter((user) =>
    user.name.toLocaleLowerCase().includes(ownerSearch.toLocaleLowerCase()),
  );
  const selectedOwnerName = selectedOwnerId === null
    ? "All owners"
    : activeUsers.find((user) => user.id === selectedOwnerId)?.name ?? "";

  return (
    <div className={styles.header}>
      <Text as="h1" size={500} weight="semibold">Personal views</Text>
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
      <Toolbar aria-label="Personal views actions">
        <ToolbarButton
          aria-label="Refresh personal views"
          icon={<ArrowClockwise24Regular />}
          disabled={refreshDisabled}
          onClick={() => void onRefresh()}
        />
      </Toolbar>
    </div>
  );
});
