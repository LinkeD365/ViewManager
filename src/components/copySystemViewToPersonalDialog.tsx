import React, { useState } from "react";
import { observer } from "mobx-react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, makeStyles, MessageBar, Option, Spinner, tokens } from "@fluentui/react-components";
import type { CopySystemViewToPersonalDialogProps } from "../model/viewModel";

const useStyles = makeStyles({
  progress: { maxHeight: "160px", overflowY: "auto" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  error: {
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
});

export const CopySystemViewToPersonalDialog = observer(({
  copies, users, selectedOwnerId, lockedOwnerId, isCopying, error, onOwnerChange, onCopy, onCancel,
}: CopySystemViewToPersonalDialogProps): React.JSX.Element => {
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const completed = copies.filter((copy) => copy.completed).length;
  const selectedOwner = users.find((user) => user.id === (lockedOwnerId ?? selectedOwnerId));
  const visibleUsers = users.filter((user) =>
    `${user.name} ${user.id}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isCopying) onCancel(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Copy {copies.length} system {copies.length === 1 ? "view" : "views"} to personal views</DialogTitle>
          <DialogContent className={styles.content}>
            <p>Create a private copy of each selected view. The original system views will not be changed.</p>
            <Field label="New owner" required>
              <Combobox
                aria-label="Owner of personal views"
                inlinePopup
                placeholder="Type to find an active user"
                value={search || selectedOwner?.name || ""}
                selectedOptions={selectedOwner ? [selectedOwner.id] : []}
                disabled={isCopying || lockedOwnerId !== null}
                onChange={(event) => {
                  setSearch(event.target.value);
                  onOwnerChange(null);
                }}
                onOptionSelect={(_event, data) => {
                  if (data.optionValue) onOwnerChange(data.optionValue);
                  setSearch("");
                }}
              >
                {visibleUsers.map((user) => <Option key={user.id} value={user.id}>{user.name}</Option>)}
                {visibleUsers.length === 0 && <Option disabled>No matching active users</Option>}
              </Combobox>
            </Field>
            <p aria-live="polite">{completed} of {copies.length} views copied.</p>
            <ul className={styles.progress}>
              {copies.map((copy) => (
                <li key={copy.personalViewId}>{copy.source.name}: {copy.completed ? "Copied" : "Pending"}</li>
              ))}
            </ul>
            {error && (
              <MessageBar className={styles.error} intent="error">{error}</MessageBar>
            )}
            {isCopying && <Spinner size="tiny" label="Copying views..." />}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={isCopying || !selectedOwner} onClick={() => void onCopy()}>
              {error ? "Retry remaining copies" : "Copy views"}
            </Button>
            <Button disabled={isCopying} onClick={onCancel}>{error ? "Close" : "Cancel"}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
});
