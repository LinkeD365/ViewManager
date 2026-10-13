import React, { useState } from "react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, makeStyles, MessageBar, Option, Spinner, tokens } from "@fluentui/react-components";
import type { ViewOwnerDialogProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: { width: "480px", maxWidth: "90vw" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
});

export const ViewOwnerDialog = ({ views, remainingCount, lockedOwnerId, users, isSaving, error, onSave, onCancel }: ViewOwnerDialogProps): React.JSX.Element => {
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const visibleUsers = users.filter((user) => user.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedOwner = users.find((user) => user.id === (lockedOwnerId ?? ownerId));
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isSaving) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Change owner of {views.length} selected views</DialogTitle>
          <DialogContent className={styles.content}>
            <p>Choose one owner for all selected views and confirm. You may lose access to these views after changing their owner.</p>
            <p>{views.length - remainingCount} of {views.length} views completed; {remainingCount} remaining.</p>
            <Field label="New owner">
              <Combobox
                aria-label="New view owner"
                inlinePopup
                placeholder="Type to find a user"
                value={search || selectedOwner?.name || ""}
                selectedOptions={selectedOwner ? [selectedOwner.id] : []}
                disabled={isSaving || lockedOwnerId !== null}
                onChange={(event) => { setSearch(event.target.value); setOwnerId(null); }}
                onOptionSelect={(_event, data) => {
                  setOwnerId(data.optionValue ?? null);
                  setSearch("");
                }}
              >
                {visibleUsers.map((user) => <Option key={user.id} value={user.id}>{user.name}</Option>)}
                {visibleUsers.length === 0 && <Option disabled>No matching users</Option>}
              </Combobox>
            </Field>
            {error && <MessageBar intent="error">{error}</MessageBar>}
            {isSaving && <Spinner size="tiny" label="Changing owner..." />}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!selectedOwner || isSaving} onClick={() => { if (selectedOwner) void onSave(selectedOwner.id); }}>
              {error ? "Retry remaining views" : "Change owner"}
            </Button>
            <Button disabled={isSaving} onClick={onCancel}>{remainingCount < views.length ? "Close" : "Cancel"}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
