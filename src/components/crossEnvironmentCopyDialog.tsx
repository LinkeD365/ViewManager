import React, { useState } from "react";
import { observer } from "mobx-react";
import {
  Button, Checkbox, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface,
  DialogTitle, makeStyles, MessageBar, Option, Spinner, tokens,
} from "@fluentui/react-components";
import { CheckmarkSquare20Filled } from "@fluentui/react-icons";
import type { CrossEnvironmentCopyDialogProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: {
    width: "min(1100px, 96vw)",
    maxWidth: "96vw",
    height: "min(820px, 92vh)",
    display: "flex",
  },
  dialogBody: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  titleText: { flex: 1, minWidth: 0 },
  progress: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "nowrap",
  },
  destinations: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gridTemplateRows: "repeat(2, 300px)",
    gap: tokens.spacingVerticalM,
  },
  destination: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    minWidth: 0,
    height: "300px",
  },
  destinationDetails: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    flex: 1,
    minHeight: 0,
  },
  views: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    margin: 0,
    paddingLeft: tokens.spacingHorizontalM,
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  view: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
  viewName: { minWidth: 0, overflowWrap: "anywhere" },
  completeIcon: { color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  error: { minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word", whiteSpace: "pre-wrap" },
});

export const CrossEnvironmentCopyDialog = observer((props: CrossEnvironmentCopyDialogProps): React.JSX.Element => {
  const {
    kind, sourceCount, sourceViews, targets, selectedTargetSlots, isTargetsLocked, personalCopies, systemCopies,
    destinations, isLoadingOptions, optionsError, isCopying, error, onTargetsChange, onOwnerChange,
    onSolutionChange, onRetryOptions, onCopy, onCancel,
  } = props;
  const styles = useStyles();
  const [searchBySlot, setSearchBySlot] = useState<Record<number, string>>({});
  const completed = kind === "personal"
    ? personalCopies.filter((copy) => copy.completed).length
    : systemCopies.filter((copy) => copy.added).length;
  const total = kind === "personal" ? personalCopies.length : systemCopies.length;
  const allReady = selectedTargetSlots.length > 0 && !isCopying && !isLoadingOptions && !optionsError
    && destinations.length === selectedTargetSlots.length
    && destinations.every((destination) => kind === "personal"
      ? !!destination.selectedOwnerId
      : !!destination.selectedSolution);

  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isCopying) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.dialogBody}>
          <DialogTitle className={styles.title}>
            <span className={styles.titleText}>
              Copy {sourceCount} {kind} {sourceCount === 1 ? "view" : "views"} to other environments
            </span>
            <span className={styles.progress} aria-live="polite">{completed} / {total} complete</span>
          </DialogTitle>
          <DialogContent className={styles.content}>
            <p>Copy from the primary environment. Choose up to six destination environments and configure each card.</p>
            <div className={styles.destinations}>
              {targets.map((target) => {
              const selected = selectedTargetSlots.includes(target.slot);
              const destination = destinations.find((item) => item.slot === target.slot);
              const targetPersonalCopies = personalCopies.filter((copy) => copy.destinationSlot === target.slot);
              const targetSystemCopies = systemCopies.filter((copy) => copy.destinationSlot === target.slot);
              return (
                <section className={styles.destination} key={target.slot} aria-label={`${target.name} destination`}>
                  <Checkbox
                    label={`${target.name} (${target.environment})`}
                    checked={selected}
                    disabled={isCopying || isTargetsLocked}
                    onChange={(_event, data) => {
                      const slots = selectedTargetSlots.filter((slot) => slot !== target.slot);
                      if (data.checked === true) slots.push(target.slot);
                      onTargetsChange(slots);
                    }}
                  />
                  <div className={styles.destinationDetails}>
                    {selected && destination?.error && (
                      <>
                        <MessageBar className={styles.error} intent="error">{destination.error}</MessageBar>
                        <Button disabled={isLoadingOptions || isCopying} onClick={() => void onRetryOptions()}>
                          Retry loading destination options
                        </Button>
                      </>
                    )}
                    {kind === "personal" && (
                      destination?.isLoading ? (
                        <Spinner size="tiny" label={`Loading users in ${target.name}...`} />
                      ) : (
                        <Combobox
                          aria-label={`New owner in ${target.name}`}
                          inlinePopup
                          placeholder="Select new owner"
                          value={destination
                            ? searchBySlot[target.slot]
                              || destination.users.find((user) => user.id === destination.selectedOwnerId)?.name || ""
                            : ""}
                          selectedOptions={destination?.selectedOwnerId ? [destination.selectedOwnerId] : []}
                          disabled={!selected || !destination || isCopying || destination.lockedOwnerId !== null
                            || destination.isLoading || destination.error !== null}
                          onChange={(event) => {
                            setSearchBySlot((current) => ({ ...current, [target.slot]: event.target.value }));
                            onOwnerChange(target.slot, null);
                          }}
                          onOptionSelect={(_event, data) => {
                            onOwnerChange(target.slot, data.optionValue ?? null);
                            setSearchBySlot((current) => ({ ...current, [target.slot]: "" }));
                          }}
                        >
                          {(destination?.users ?? []).filter((user) =>
                            `${user.name} ${user.id}`.toLocaleLowerCase()
                              .includes((searchBySlot[target.slot] ?? "").toLocaleLowerCase()))
                            .map((user) => <Option key={user.id} value={user.id}>{user.name}</Option>)}
                        </Combobox>
                      )
                    )}
                    {kind === "system" && (
                      destination?.isLoading ? (
                        <Spinner size="tiny" label={`Loading solutions in ${target.name}...`} />
                      ) : (
                        <Combobox
                          aria-label={`Unmanaged solution in ${target.name}`}
                          inlinePopup
                          placeholder="Select unmanaged solution"
                          value={destination
                            ? searchBySlot[target.slot]
                              || destination.solutions.find((item) => item.uniqueName === destination.selectedSolution)?.name || ""
                            : ""}
                          selectedOptions={destination?.selectedSolution ? [destination.selectedSolution] : []}
                          disabled={!selected || !destination || isCopying || destination.lockedSolution !== null
                            || destination.error !== null}
                          onChange={(event) => {
                            setSearchBySlot((current) => ({ ...current, [target.slot]: event.target.value }));
                            onSolutionChange(target.slot, null);
                          }}
                          onOptionSelect={(_event, data) => {
                            onSolutionChange(target.slot, data.optionValue ?? null);
                            setSearchBySlot((current) => ({ ...current, [target.slot]: "" }));
                          }}
                        >
                          {(destination?.solutions ?? []).filter((solution) =>
                            `${solution.name} ${solution.uniqueName} ${solution.version}`.toLocaleLowerCase()
                              .includes((searchBySlot[target.slot] ?? "").toLocaleLowerCase()))
                            .map((solution) => (
                              <Option key={solution.id} value={solution.uniqueName}
                                text={`${solution.name} (${solution.uniqueName}) - ${solution.version}`}>
                                {solution.name} ({solution.uniqueName}) - {solution.version}
                              </Option>
                            ))}
                        </Combobox>
                      )
                    )}
                    <ul className={styles.views} aria-label={`Views to copy to ${target.name}`}>
                      {sourceViews.map((source) => {
                        const personalCopy = targetPersonalCopies.find((copy) => copy.source.id === source.id);
                        const systemCopy = targetSystemCopies.find((copy) => copy.source.id === source.id);
                        const isComplete = kind === "personal"
                          ? personalCopy?.completed === true
                          : systemCopy?.added === true;
                        return (
                          <li className={styles.view} key={source.id}>
                            <span className={styles.viewName}>{source.name} — {source.tableName}</span>
                            {isComplete && (
                              <CheckmarkSquare20Filled
                                className={styles.completeIcon}
                                aria-label={`${source.name} copied`}
                                title="Copied"
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </section>
              );
              })}
            </div>
            {optionsError && <MessageBar className={styles.error} intent="error">{optionsError}</MessageBar>}
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
