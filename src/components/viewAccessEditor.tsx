import React from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Listbox, makeStyles, MessageBar, Option, tokens } from "@fluentui/react-components";
import { getAccessMaskFromSelection, isEditableAccessMask, selectableAccessRights, selectableAccessRightsMask } from "../model/viewModel";
import type { ViewAccessEditorProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: {
    width: "360px",
    maxWidth: "90vw",
  },
  listbox: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalXS,
    maxHeight: "200px",
    overflowY: "auto",
  },
});

export const ViewAccessEditor = ({ principal, onChange, onClose }: ViewAccessEditorProps): React.JSX.Element => {
  const editable = isEditableAccessMask(principal.accessRightsMask);
  const styles = useStyles();
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open) onClose(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Access rights for {principal.name}</DialogTitle>
          <DialogContent>
            <Field label="Access rights">
              <Listbox
                aria-label="Access rights"
                className={styles.listbox}
                multiselect
                aria-disabled={!editable}
                selectedOptions={selectableAccessRights.filter(([value]) => (principal.accessRightsMask & value) !== 0).map(([value]) => String(value))}
                onOptionSelect={(_event, data) => {
                  onChange(getAccessMaskFromSelection(principal.accessRightsMask, data.selectedOptions));
                }}
              >
                {selectableAccessRights.map(([value, label]) => <Option key={value} value={String(value)} disabled={!editable}>{label}</Option>)}
              </Listbox>
            </Field>
            {editable && (principal.accessRightsMask & ~selectableAccessRightsMask) !== 0 && (
              <MessageBar>Existing permissions not listed in this picker will be preserved when saving.</MessageBar>
            )}
            {!editable ? (
              <MessageBar intent="warning">This record contains unsupported rights and cannot be edited.</MessageBar>
            ) : principal.accessRightsMask === 0 ? (
              <MessageBar intent="warning">Saving with no permissions selected will revoke this user's or team's share. Other sources of access may still apply.</MessageBar>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>Done</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
