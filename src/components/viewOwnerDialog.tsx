import React, { useState } from "react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, makeStyles, MessageBar, Option, Spinner, tokens } from "@fluentui/react-components";
import type { ViewOwnerDialogProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: { width: "480px", maxWidth: "90vw" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
});

export const ViewOwnerDialog = ({ views, targetEnvironment, remainingCount, lockedOwnerId, users, isSaving, error, onSave, onCancel }: ViewOwnerDialogProps): React.JSX.Element => {
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const visibleUsers = users.filter((user) => user.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectedOwner = users.find((user) => user.id === (lockedOwnerId ?? ownerId));
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isSaving) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Change owner of {views.length} selected views</DialogTitle>
          <DialogContent className={styles.content}>
            <MessageBar>Target environment: {targetEnvironment}</MessageBar>
            <p>Reassign up to 100 views per operation.</p>
            {confirming ? (
              <>
                <p>Review the ownership changes before applying them. You may lose access to these views afterward.</p>
                <MessageBar intent="warning">
                  Closing this form will not undo completed assignments. Export the selected views' backup first; View Manager does not restore backups.
                </MessageBar>
                <ul>
                  {views.map((view) => (
                    <li key={view.id}>{view.name}: {view.ownerName || view.ownerId} → {selectedOwner?.name}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Choose one owner for all selected views. The listed views will be reassigned together.</p>
            )}
            <p>{views.length - remainingCount} of {views.length} views completed; {remainingCount} remaining.</p>
            {!confirming && <Field label="New owner">
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
            </Field>}
            {error && <MessageBar intent="error">{error}</MessageBar>}
            {isSaving && <Spinner size="tiny" label="Changing owner..." />}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={!selectedOwner || isSaving}
              onClick={() => {
                if (!selectedOwner) return;
                if (!confirming && !error) setConfirming(true);
                else void onSave(selectedOwner.id);
              }}
            >
              {error ? "Retry remaining views" : confirming ? "Confirm owner changes" : "Review changes"}
            </Button>
            <Button disabled={isSaving} onClick={() => confirming && !lockedOwnerId ? setConfirming(false) : onCancel()}>
              {confirming && !lockedOwnerId ? "Back" : remainingCount < views.length ? "Close" : "Cancel"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
