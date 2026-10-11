import React, { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { makeStyles, MessageBar, Spinner, tokens } from "@fluentui/react-components";
import type { PersonalView, ViewAccess, ViewStudioProps } from "../model/viewModel";
import { ViewStudioHeader } from "./viewStudioHeader";
import { PersonalViewsGrid } from "./personalViewsGrid";
import { ViewAccessPanel } from "./viewAccessPanel";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    height: "100%",
    padding: tokens.spacingVerticalL,
  },
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
    gap: tokens.spacingHorizontalL,
    flex: 1,
    minHeight: "400px",
  },
});

export const ViewStudio = observer((props: ViewStudioProps): React.JSX.Element => {
  const { connection, dvSvc, vm, onLog, notifyError } = props;
  const styles = useStyles();

  const loadViews = useCallback(async () => {
    if (!dvSvc) return;
    try {
      await vm.loadPersonalViews(dvSvc, vm.selectedOwnerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load personal views.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  const loadUsers = useCallback(async () => {
    if (!dvSvc) return;
    try {
      await vm.loadUsers(dvSvc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load active users.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (dvSvc && vm.hasLoadedUsers && !vm.isLoadingUsers && !vm.usersError) {
      void loadViews();
    }
  }, [dvSvc, vm.selectedOwnerId, vm.isLoadingUsers, vm.usersError, loadViews]);

  const selectView = useCallback(async (view: PersonalView | null) => {
    if (!dvSvc || vm.isLoadingPersonalViews || vm.isLoadingUsers) return;
    try {
      await vm.selectView(dvSvc, view);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load view access.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  const changeAccess = useCallback((principal: ViewAccess, mask: number) => {
    try {
      vm.stageViewAccess(principal, mask);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to edit view access.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const saveAccess = useCallback(async () => {
    if (!dvSvc) return;
    try {
      await vm.saveViewAccess(dvSvc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save view access.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  return (
    <div className={styles.root}>
      <ViewStudioHeader
        activeUsers={vm.activeUsers}
        selectedOwnerId={vm.selectedOwnerId}
        ownerDisabled={!connection || vm.isLoadingUsers || vm.accessNavigationLocked}
        refreshDisabled={!connection || vm.isLoadingPersonalViews || vm.accessNavigationLocked}
        onOwnerChange={(ownerId) => vm.setSelectedOwner(ownerId)}
        onRefresh={loadViews}
      />
      {!connection ? (
        <MessageBar>No active Dataverse connection. Connect to an environment to view personal views.</MessageBar>
      ) : vm.personalViewsError ? (
        <MessageBar intent="error">{vm.personalViewsError}</MessageBar>
      ) : vm.usersError ? (
        <MessageBar intent="error">{vm.usersError}</MessageBar>
      ) : vm.isLoadingUsers ? (
        <Spinner label="Loading active users..." />
      ) : vm.isLoadingPersonalViews && vm.personalViews.length === 0 ? (
        <Spinner label="Loading personal views..." />
      ) : (
        <div className={styles.split}>
          <PersonalViewsGrid views={vm.personalViews} onSelectView={selectView} selectionDisabled={vm.accessNavigationLocked} />
          <ViewAccessPanel
            key={vm.selectedView?.id ?? "none"}
            selectedView={vm.selectedView}
            access={vm.displayedViewAccess}
            isLoading={vm.isLoadingViewAccess}
            error={vm.viewAccessError}
            hasChanges={vm.hasAccessChanges}
            isSaving={vm.isSavingViewAccess}
            saveError={vm.viewAccessSaveError}
            saveMessage={vm.viewAccessSaveMessage}
            onChange={changeAccess}
            onSave={saveAccess}
            onDiscard={() => vm.discardAccessChanges()}
          />
        </div>
      )}
    </div>
  );
});
