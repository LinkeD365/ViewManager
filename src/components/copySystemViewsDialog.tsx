import React, { useState } from "react";
import { observer } from "mobx-react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, makeStyles, MessageBar, Option, Spinner, Text, tokens } from "@fluentui/react-components";
import type { CopySystemViewsDialogProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: { width: "560px", maxWidth: "90vw" },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  progress: { maxHeight: "140px", overflowY: "auto" },
});

export const CopySystemViewsDialog = observer(({
  copies, targetEnvironment, solutions, isLoadingSolutions, solutionsError, isCopying, lockedSolution, error,
  onRetrySolutions, onCopy, onCancel,
}: CopySystemViewsDialogProps): React.JSX.Element => {
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [uniqueName, setUniqueName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selected = solutions.find((solution) => solution.uniqueName === (lockedSolution ?? uniqueName));
  const visibleSolutions = solutions.filter((solution) =>
    `${solution.name} ${solution.uniqueName} ${solution.version}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const completed = copies.filter((copy) => copy.added).length;
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open && !isCopying) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Copy {copies.length} personal views to system views</DialogTitle>
          <DialogContent className={styles.content}>
            <MessageBar>Target environment: {targetEnvironment}</MessageBar>
            <p>Copies keep the original names, filters and layouts. Your personal views and their sharing remain unchanged.</p>
            <p>Copy up to 100 views per operation.</p>
            {confirming && (
              <>
                <Text weight="semibold">Review before copying</Text>
                <p>{copies.length} personal {copies.length === 1 ? "view" : "views"} will be created as public system views in {selected?.name} ({selected?.uniqueName}).</p>
                <MessageBar intent="warning">
                  Closing this form will not remove created views or undo solution additions.
                </MessageBar>
                <ul className={styles.progress}>
                  {copies.map((copy) => <li key={copy.systemViewId}>{copy.source.name} ({copy.source.tableName})</li>)}
                </ul>
              </>
            )}
            <MessageBar intent="warning">
              Copies are public system views, not private shares. Access depends on users' security roles.
              They will not replace default views. Review and publish from the chosen solution as needed;
              this action does not publish customizations.
            </MessageBar>
            <Field label="Unmanaged solution" required>
              <Combobox
                aria-label="Unmanaged solution"
                inlinePopup
                placeholder="Search solutions"
                value={search || (selected ? `${selected.name} (${selected.uniqueName})` : "")}
                selectedOptions={selected ? [selected.uniqueName] : []}
                disabled={isLoadingSolutions || isCopying || confirming || lockedSolution !== null || !!solutionsError}
                onChange={(event) => { setSearch(event.target.value); setUniqueName(null); }}
                onOptionSelect={(_event, data) => { setUniqueName(data.optionValue ?? null); setSearch(""); }}
              >
                {visibleSolutions.map((solution) => (
                  <Option key={solution.id} value={solution.uniqueName} text={`${solution.name} (${solution.uniqueName})`}>
                    {solution.name} ({solution.uniqueName}) - {solution.version}
                  </Option>
                ))}
                {visibleSolutions.length === 0 && <Option disabled>No matching unmanaged solutions</Option>}
              </Combobox>
            </Field>
            {isLoadingSolutions && <Spinner size="tiny" label="Loading unmanaged solutions..." />}
            {solutionsError && (
              <>
                <MessageBar intent="error">{solutionsError}</MessageBar>
                <Button disabled={isLoadingSolutions} onClick={() => void onRetrySolutions()}>Retry loading solutions</Button>
              </>
            )}
            {!isLoadingSolutions && !solutionsError && solutions.length === 0 && (
              <MessageBar>No available unmanaged solutions. Create one in Power Apps, then retry loading solutions.</MessageBar>
            )}
            {!isLoadingSolutions && !solutionsError && solutions.length === 0 && (
              <Button onClick={() => void onRetrySolutions()}>Retry loading solutions</Button>
            )}
            <p aria-live="polite">{completed} of {copies.length} views added to the solution.</p>
            <ul className={styles.progress}>
              {copies.map((copy) => (
                <li key={copy.systemViewId}>
                  {copy.source.name}: {copy.added ? "Added to solution" : copy.created ? "Created; not yet added to solution" : "Pending"}
                  {copy.created && !copy.added && ` (${copy.systemViewId})`}
                </li>
              ))}
            </ul>
            {error && <MessageBar intent="error">{error}</MessageBar>}
            {lockedSolution && (
              <MessageBar>
                Retry uses the same copy IDs and solution. Closing does not undo created views, including copies not yet
                added to the solution. An interrupted request may also have created a copy. Starting a new operation
                creates new copies.
              </MessageBar>
            )}
            {isCopying && <Spinner size="tiny" label="Copying views..." />}
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={!selected || isLoadingSolutions || !!solutionsError || isCopying}
              onClick={() => {
                if (!selected) return;
                if (!confirming) setConfirming(true);
                else void onCopy(selected.uniqueName);
              }}
            >
              {error && confirming ? "Retry remaining copies" : confirming ? "Confirm and copy views" : "Review copy"}
            </Button>
            <Button
              disabled={isCopying}
              onClick={() => confirming && !lockedSolution ? setConfirming(false) : onCancel()}
            >
              {confirming && !lockedSolution ? "Back" : lockedSolution ? "Close" : "Cancel"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
});
