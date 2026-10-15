import React, { useState } from "react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Listbox, makeStyles, MessageBar, Option, Spinner, Text, tokens } from "@fluentui/react-components";
import { getAccessMaskFromSelection, selectableAccessRights } from "../model/viewModel";
import type { AddViewUsersDialogProps } from "../model/viewModel";
import { MAX_BULK_ACCESS_CHANGES } from "../model/operationLimits";

const useStyles = makeStyles({
  surface: { width: "560px", maxWidth: "90vw" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  selectedUsers: { maxHeight: "100px", overflowY: "auto" },
  listbox: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalXS,
  },
});

export const AddViewUsersDialog = ({
  viewNames, targetEnvironment, users, isSaving, inputsLocked, totalCount, remainingCount, error, onSave, onCancel,
}: AddViewUsersDialogProps): React.JSX.Element => {
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [mask, setMask] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const disabled = isSaving || inputsLocked || confirming;
  const visibleUsers = users.filter((user) => user.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedUsers = users.filter((user) => userIds.includes(user.id));
  const completed = totalCount - remainingCount;
  const requestedChanges = selectedUsers.length * viewNames.length;
  const exceedsLimit = requestedChanges > MAX_BULK_ACCESS_CHANGES;
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isSaving) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Add users to {viewNames.length} selected {viewNames.length === 1 ? "view" : "views"}</DialogTitle>
          <DialogContent className={styles.content}>
            <MessageBar>Target environment: {targetEnvironment}</MessageBar>
            <MessageBar intent="warning">
              Applying access will replace the selected users' existing direct sharing permissions on every selected view
              with exactly the permissions chosen below, including removing existing permissions not shown here.
              Access through ownership, security roles or teams is not changed.
            </MessageBar>
            {exceedsLimit && (
              <MessageBar intent="error">This selection exceeds the {MAX_BULK_ACCESS_CHANGES}-change limit. Select fewer users.</MessageBar>
            )}
            {confirming && (
              <>
                <Text weight="semibold">Review these changes</Text>
                <MessageBar intent="warning">
                  Closing this form will not undo completed changes. Export the selected views' backup first; View Manager does not restore backups.
                </MessageBar>
                <Text>Views: {viewNames.join(", ")}</Text>
                <Text>Users: {selectedUsers.map((user) => user.name).join(", ")}</Text>
                <Text>Permissions: {selectableAccessRights
                  .filter(([value]) => (mask & value) !== 0)
                  .map(([, label]) => label).join(", ")}</Text>
              </>
            )}
            <Field label="Users">
              <Combobox
                aria-label="Users to give access"
                multiselect
                inlinePopup
                placeholder="Type to find users"
                value={search}
                selectedOptions={userIds}
                disabled={disabled}
                onChange={(event) => setSearch(event.target.value)}
                onOptionSelect={(_event, data) => {
                  setUserIds(data.selectedOptions);
                  setSearch("");
                }}
              >
                {visibleUsers.map((user) => <Option key={user.id} value={user.id}>{user.name}</Option>)}
                {visibleUsers.length === 0 && <Option disabled>No matching users</Option>}
              </Combobox>
            </Field>
            <Text className={styles.selectedUsers}>
              Selected users ({selectedUsers.length}): {selectedUsers.map((user) => user.name).join(", ") || "None"}
            </Text>
            <Field label="Permissions for every selected user and view">
              <Listbox
                aria-label="Permissions to apply"
                className={styles.listbox}
                multiselect
                aria-disabled={disabled}
                selectedOptions={selectableAccessRights.filter(([value]) => (mask & value) !== 0).map(([value]) => String(value))}
                onOptionSelect={(_event, data) => {
                  if (!disabled) setMask(getAccessMaskFromSelection(0, data.selectedOptions));
                }}
              >
                {selectableAccessRights.map(([value, label]) => (
                  <Option key={value} value={String(value)} disabled={disabled}>{label}</Option>
                ))}
              </Listbox>
            </Field>
            {mask === 0 && <MessageBar intent="warning">Select at least one permission to give access.</MessageBar>}
            <Text>
              {totalCount > 0
                ? `${completed} of ${totalCount} user/view changes completed; ${remainingCount} remaining.`
                : `${selectedUsers.length} users across ${viewNames.length} views: ${requestedChanges} of ${MAX_BULK_ACCESS_CHANGES} maximum user/view changes.`}
            </Text>
            {error && <MessageBar intent="error">{error}</MessageBar>}
            {isSaving && <Spinner size="tiny" label="Applying access..." />}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={selectedUsers.length === 0 || mask === 0 || exceedsLimit || isSaving}
              onClick={() => {
                if (!confirming && !error) setConfirming(true);
                else void onSave(userIds, mask);
              }}
            >
              {error ? "Retry remaining changes" : confirming ? "Confirm and apply access" : "Review changes"}
            </Button>
            <Button disabled={isSaving} onClick={() => confirming && !inputsLocked ? setConfirming(false) : onCancel()}>
              {confirming && !inputsLocked ? "Back" : completed > 0 ? "Close" : "Cancel"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
