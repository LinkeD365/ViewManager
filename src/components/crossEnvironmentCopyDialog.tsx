import React, { useState } from "react";
import { observer } from "mobx-react";
import {
  Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Dropdown, Field, makeStyles, MessageBar, Option, Spinner, tokens,
} from "@fluentui/react-components";
import type { CrossEnvironmentCopyDialogProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: { width: "640px", maxWidth: "92vw" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  destination: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  progress: { maxHeight: "180px", overflowY: "auto" },
  error: { minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "pre-wrap" },
});

export const CrossEnvironmentCopyDialog = observer((props: CrossEnvironmentCopyDialogProps): React.JSX.Element => {
  const {
    kind, sourceCount, targets, selectedTargetSlots, isTargetsLocked, personalCopies, systemCopies, destinations,
    isLoadingOptions, optionsError, isCopying, error, onTargetsChange, onOwnerChange,
    onSolutionChange, onRetryOptions, onCopy, onCancel,
  } = props;
  const styles = useStyles();
  const [searchBySlot, setSearchBySlot] = useState<Record<number, string>>({});
  const copies = kind === "personal" ? personalCopies : systemCopies;
  const completed = kind === "personal"
    ? personalCopies.filter((copy) => copy.completed).length
    : systemCopies.filter((copy) => copy.added).length;
  const allReady = selectedTargetSlots.length > 0 && !isCopying && !isLoadingOptions && !optionsError
    && destinations.length === selectedTargetSlots.length
    && destinations.every((destination) => kind === "personal"
      ? !!destination.selectedOwnerId
      : !!destination.selectedSolution);

  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isCopying) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Copy {sourceCount} {kind} {sourceCount === 1 ? "view" : "views"} to other environments</DialogTitle>
          <DialogContent className={styles.content}>
            <p>Copy from the primary environment. Select one or more configured destinations below.</p>
            <Field label="Destination environments" required>
              <Dropdown
                aria-label="Destination environments"
                placeholder="Select destinations"
                multiselect
                inlinePopup
                selectedOptions={selectedTargetSlots.map(String)}
                value={selectedTargetSlots.map((slot) => targets.find((target) => target.slot === slot)?.name ?? "").join(", ")}
                disabled={isCopying || isTargetsLocked}
                onOptionSelect={(_event, data) => {
                  onTargetsChange(data.selectedOptions.map(Number));
                }}
              >
                {targets.map((target) => (
                  <Option key={target.slot} value={String(target.slot)} text={`${target.name} (${target.environment})`}>
                    {target.name} ({target.environment})
                  </Option>
                ))}
              </Dropdown>
            </Field>
            {selectedTargetSlots.length === 0 && <MessageBar>Select at least one destination environment.</MessageBar>}
            {destinations.map((destination) => (
              <div className={styles.destination} key={destination.slot}>
                <strong>{destination.name} ({destination.environment})</strong>
                {destination.isLoading && <Spinner size="tiny" label={`Loading ${kind === "personal" ? "users" : "solutions"}...`} />}
                {destination.error && <MessageBar className={styles.error} intent="error">{destination.error}</MessageBar>}
                {!destination.error && kind === "personal" && (
                  <Field label="New owner in destination" required>
                    <Combobox
                      aria-label={`New owner in ${destination.name}`}
                      inlinePopup
                      placeholder="Search destination users"
                      value={searchBySlot[destination.slot]
                        || destination.users.find((user) => user.id === destination.selectedOwnerId)?.name || ""}
                      selectedOptions={destination.selectedOwnerId ? [destination.selectedOwnerId] : []}
                      disabled={isCopying || destination.lockedOwnerId !== null || destination.isLoading}
                      onChange={(event) => {
                        setSearchBySlot((current) => ({ ...current, [destination.slot]: event.target.value }));
                        onOwnerChange(destination.slot, null);
                      }}
                      onOptionSelect={(_event, data) => {
                        onOwnerChange(destination.slot, data.optionValue ?? null);
                        setSearchBySlot((current) => ({ ...current, [destination.slot]: "" }));
                      }}
                    >
                      {destination.users.filter((user) =>
                        `${user.name} ${user.id}`.toLocaleLowerCase()
                          .includes((searchBySlot[destination.slot] ?? "").toLocaleLowerCase()))
                        .map((user) => <Option key={user.id} value={user.id}>{user.name}</Option>)}
                    </Combobox>
                  </Field>
                )}
                {!destination.error && kind === "system" && (
                  <Field label="Unmanaged solution in destination" required>
                    <Combobox
                      aria-label={`Unmanaged solution in ${destination.name}`}
                      inlinePopup
                      placeholder="Search destination solutions"
                      value={searchBySlot[destination.slot]
                        || destination.solutions.find((item) => item.uniqueName === destination.selectedSolution)?.name || ""}
                      selectedOptions={destination.selectedSolution ? [destination.selectedSolution] : []}
                      disabled={isCopying || destination.lockedSolution !== null || destination.isLoading}
                      onChange={(event) => {
                        setSearchBySlot((current) => ({ ...current, [destination.slot]: event.target.value }));
                        onSolutionChange(destination.slot, null);
                      }}
                      onOptionSelect={(_event, data) => {
                        onSolutionChange(destination.slot, data.optionValue ?? null);
                        setSearchBySlot((current) => ({ ...current, [destination.slot]: "" }));
                      }}
                    >
                      {destination.solutions.filter((solution) =>
                        `${solution.name} ${solution.uniqueName} ${solution.version}`.toLocaleLowerCase()
                          .includes((searchBySlot[destination.slot] ?? "").toLocaleLowerCase()))
                        .map((solution) => (
                          <Option key={solution.id} value={solution.uniqueName}
                            text={`${solution.name} (${solution.uniqueName}) - ${solution.version}`}>
                            {solution.name} ({solution.uniqueName}) - {solution.version}
                          </Option>
                        ))}
                    </Combobox>
                  </Field>
                )}
              </div>
            ))}
            {optionsError && (
              <>
                <MessageBar className={styles.error} intent="error">{optionsError}</MessageBar>
                <Button disabled={isLoadingOptions || isCopying} onClick={() => void onRetryOptions()}>
                  Retry loading destination options
                </Button>
              </>
            )}
            {kind === "personal" ? (
              <ul className={styles.progress}>
                {personalCopies.map((copy) => (
                  <li key={`${copy.destinationSlot}-${copy.targetViewId}`}>
                    {targets.find((target) => target.slot === copy.destinationSlot)?.name}: {copy.source.name} — {copy.completed ? "Copied" : "Pending"}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className={styles.progress}>
                {systemCopies.map((copy) => (
                  <li key={`${copy.destinationSlot}-${copy.targetViewId}`}>
                    {targets.find((target) => target.slot === copy.destinationSlot)?.name}: {copy.source.name} — {copy.added
                      ? "Created and added to solution" : copy.created ? "Created; not yet added" : "Pending"}
                  </li>
                ))}
              </ul>
            )}
            <p aria-live="polite">{completed} of {copies.length} destination copies completed.</p>
            {error && <MessageBar className={styles.error} intent="error">{error}</MessageBar>}
            {isCopying && <Spinner size="tiny" label="Copying views to selected environments..." />}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={!allReady} onClick={() => void onCopy()}>
              {error ? "Retry remaining copies" : "Copy views"}
            </Button>
            <Button disabled={isCopying} onClick={onCancel}>{error ? "Close" : "Cancel"}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
});
