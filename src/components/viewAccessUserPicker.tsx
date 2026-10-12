import React, { useState } from "react";
import { Button, Combobox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, makeStyles, Option } from "@fluentui/react-components";
import type { ViewAccessUserPickerProps } from "../model/viewModel";

const useStyles = makeStyles({
  surface: { width: "400px", maxWidth: "90vw" },
});

export const ViewAccessUserPicker = ({ users, onSelect, onCancel }: ViewAccessUserPickerProps): React.JSX.Element => {
  const [search, setSearch] = useState("");
  const styles = useStyles();
  const visibleUsers = users.filter((user) => user.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return (
    <Dialog open onOpenChange={(_event, data) => { if (!data.open) onCancel(); }}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Add a user to this view</DialogTitle>
          <DialogContent>
            <Field label="User">
              <Combobox
                aria-label="User to add"
                inlinePopup
                placeholder="Type to find a user"
                value={search}
                selectedOptions={[]}
                onChange={(event) => setSearch(event.target.value)}
                onOptionSelect={(_event, data) => {
                  if (data.optionValue) onSelect(data.optionValue);
                }}
              >
                {visibleUsers.map((user) => <Option key={user.id} value={user.id}>{user.name}</Option>)}
                {visibleUsers.length === 0 && <Option disabled>No matching users</Option>}
              </Combobox>
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCancel}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
