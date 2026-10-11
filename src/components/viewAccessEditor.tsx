import React from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, MessageBar, Option } from "@fluentui/react-components";
import { formatAccessRights, getAccessMaskFromSelection, isEditableAccessMask, selectableAccessRights, selectableAccessRightsMask } from "../model/viewModel";
import type { ViewAccessEditorProps } from "../model/viewModel";

export const ViewAccessEditor = ({ principal, onChange, onClose }: ViewAccessEditorProps): React.JSX.Element => {
  const editable = isEditableAccessMask(principal.accessRightsMask);
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Access rights for {principal.name}</DialogTitle>
          <DialogContent>
            <Field label="Access rights">
              <Dropdown
                multiselect
                inlinePopup
                disabled={!editable}
                value={formatAccessRights(principal.accessRightsMask & selectableAccessRightsMask)}
                selectedOptions={selectableAccessRights.filter(([value]) => (principal.accessRightsMask & value) !== 0).map(([value]) => String(value))}
                onOptionSelect={(_event, data) => {
                  onChange(getAccessMaskFromSelection(principal.accessRightsMask, data.selectedOptions));
                }}
              >
                {selectableAccessRights.map(([value, label]) => <Option key={value} value={String(value)}>{label}</Option>)}
              </Dropdown>
            </Field>
            {editable && (principal.accessRightsMask & ~selectableAccessRightsMask) !== 0 && (
              <MessageBar>Existing permissions not listed in this picker will be preserved when saving.</MessageBar>
            )}
            {!editable ? (
              <MessageBar intent="warning">This record contains unsupported rights and cannot be edited.</MessageBar>
            ) : principal.accessRightsMask === 0 ? (
              <MessageBar intent="warning">Saving with no permissions selected will revoke this user's or team's share. Other sources of access may still apply.</MessageBar>
            ) : (
              <MessageBar>Changes are staged locally. Use the Save icon in the access panel header to apply them.</MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>Done</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
