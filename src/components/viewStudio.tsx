import React, { useCallback, useEffect } from "react";
import { observer } from "mobx-react";
import { makeStyles, MessageBar, Spinner, Tab, TabList, tokens, useId } from "@fluentui/react-components";
import type { PersonalView, ViewAccess, ViewStudioProps } from "../model/viewModel";
import { ViewStudioHeader } from "./viewStudioHeader";
import { PersonalViewsGrid } from "./personalViewsGrid";
import { ViewAccessPanel } from "./viewAccessPanel";
import { ViewOwnerDialog } from "./viewOwnerDialog";
import { AddViewUsersDialog } from "./addViewUsersDialog";
import { SystemViews } from "./systemViews";
import { CopySystemViewsDialog } from "./copySystemViewsDialog";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    height: "100%",
    padding: tokens.spacingVerticalL,
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    flex: 1,
    minHeight: 0,
    "&[hidden]": { display: "none" },
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
  const { connection, dvSvc, vm, onLog, notifyError, notifySuccess } = props;
  const styles = useStyles();
  const tabsId = useId("view-studio-tabs");

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

  const loadTables = useCallback(async () => {
    if (!dvSvc) return;
    try {
      await vm.loadTables(dvSvc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load tables.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  const loadSystemViews = useCallback(async () => {
    if (!dvSvc) return;
    try {
      await vm.loadSystemViews(dvSvc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load system views.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  useEffect(() => {
    void loadUsers();
    return () => {
      vm.resetOwnerChange();
      vm.resetBulkAccess();
      vm.copySystemViews.reset();
      vm.resetSystemViews();
    };
  }, [loadUsers, vm]);

  useEffect(() => {
    if (dvSvc && vm.hasLoadedUsers && !vm.isLoadingUsers && !vm.usersError) {
      if (vm.selectedOwnerId === null) void loadTables();
      void loadViews();
    }
  }, [dvSvc, vm.selectedOwnerId, vm.selectedTableLogicalName, vm.isLoadingUsers, vm.usersError, loadTables, loadViews]);

  useEffect(() => {
    if (dvSvc && vm.activeTab === "system" && !vm.isLoadingUsers) void loadTables();
  }, [dvSvc, vm.activeTab, vm.isLoadingUsers, loadTables]);

  useEffect(() => {
    if (dvSvc && vm.selectedSystemTableLogicalName !== null && !vm.isLoadingUsers) void loadSystemViews();
  }, [dvSvc, vm.selectedSystemTableLogicalName, vm.isLoadingUsers, loadSystemViews]);

  const selectSystemTable = useCallback((logicalName: string) => {
    try {
      vm.setSelectedSystemTable(logicalName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to select this table.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const selectTable = useCallback((logicalName: string) => {
    try {
      vm.setSelectedTable(logicalName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to select this table.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const selectViews = useCallback(async (views: PersonalView[]) => {
    if (!dvSvc || vm.isLoadingPersonalViews || vm.isLoadingUsers) return;
    try {
      await vm.selectViews(dvSvc, views);
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

  const removeAccess = useCallback((principal: ViewAccess) => {
    try {
      vm.removeViewAccess(principal);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove user access.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const addAccessUser = useCallback(() => {
    try {
      vm.beginAddAccessUser();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add a user.";
      onLog(message, "error");
      notifyError(message);
      return false;
    }
  }, [vm, onLog, notifyError]);

  const selectAccessUser = useCallback((userId: string) => {
    try {
      vm.selectAccessUser(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to select this user.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const saveAccess = useCallback(async () => {
    if (!dvSvc) return;
    try {
      const saved = await vm.saveViewAccess(dvSvc);
      if (saved) notifySuccess("Access changes saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save view access.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError, notifySuccess]);

  const beginChangeOwner = useCallback(() => {
    try {
      vm.beginChangeViewOwner();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change the view's owner.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const changeOwner = useCallback(async (ownerId: string) => {
    if (!dvSvc) return;
    try {
      if (await vm.changeViewOwner(dvSvc, ownerId)) notifySuccess("Selected view owners changed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change the view's owner.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError, notifySuccess]);

  const beginAddUsers = useCallback(() => {
    try {
      vm.beginAddUsersToViews();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add users to the selected views.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, onLog, notifyError]);

  const saveBulkAccess = useCallback(async (userIds: string[], mask: number) => {
    if (!dvSvc) return;
    try {
      if (await vm.saveBulkViewAccess(dvSvc, userIds, mask)) notifySuccess("User access applied to the selected views.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply access to the selected views.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError, notifySuccess]);

  const loadCopySolutions = useCallback(async () => {
    if (!dvSvc) return;
    try {
      await vm.copySystemViews.loadSolutions(dvSvc);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load unmanaged solutions.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, onLog, notifyError]);

  const beginCopyViews = useCallback(() => {
    try {
      vm.beginCopySystemViews();
      void loadCopySolutions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to copy personal views.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [vm, loadCopySolutions, onLog, notifyError]);

  const copyViews = useCallback(async (uniqueName: string) => {
    if (!dvSvc) return;
    try {
      const count = vm.copySystemViews.copies.length;
      if (await vm.copySystemViews.copy(dvSvc, uniqueName)) {
        notifySuccess(`${count} personal views copied to system views and added to the solution. Review and publish from the solution as needed.`);
        await loadSystemViews();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to copy personal views.";
      onLog(message, "error");
      notifyError(message);
    }
  }, [dvSvc, vm, loadSystemViews, onLog, notifyError, notifySuccess]);

  const cancelCopyViews = useCallback(() => {
    if (vm.copySystemViews.isCopying) return;
    const attempted = vm.copySystemViews.lockedSolution !== null;
    vm.copySystemViews.cancel();
    if (attempted) void loadSystemViews();
  }, [vm, loadSystemViews]);

  return (
    <div className={styles.root}>
      <TabList
        aria-label="View type"
        size="small"
        selectedValue={vm.activeTab}
        onTabSelect={(_event, data) => {
          if (data.value === "personal" || data.value === "system") vm.setActiveTab(data.value);
        }}
      >
        <Tab id={`${tabsId}-personal`} aria-controls={`${tabsId}-personal-panel`} value="personal">
          Personal views
        </Tab>
        <Tab
          id={`${tabsId}-system`}
          aria-controls={`${tabsId}-system-panel`}
          value="system"
          disabled={vm.accessNavigationLocked}
        >
          System views
        </Tab>
      </TabList>
      <div
        className={styles.panel}
        id={`${tabsId}-personal-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-personal`}
        hidden={vm.activeTab !== "personal"}
      >
      <ViewStudioHeader
        activeUsers={vm.activeUsers}
        selectedOwnerId={vm.selectedOwnerId}
        tables={vm.tables}
        selectedTableLogicalName={vm.selectedTableLogicalName}
        tableDisabled={!connection || vm.isLoadingUsers || vm.isLoadingTables || !vm.hasLoadedTables || vm.accessNavigationLocked}
        ownerDisabled={!connection || vm.isLoadingUsers || vm.accessNavigationLocked}
        refreshDisabled={!connection || vm.isLoadingUsers || vm.isLoadingTables || vm.isLoadingPersonalViews
          || vm.accessNavigationLocked || (!vm.canLoadPersonalViews && !vm.tablesError)}
        onOwnerChange={(ownerId) => vm.setSelectedOwner(ownerId)}
        onTableChange={selectTable}
        onRefresh={vm.selectedOwnerId === null && vm.tablesError ? loadTables : loadViews}
        changeOwnerDisabled={!connection || !vm.canChangeViewOwners}
        selectedViewCount={vm.selectedViews.length}
        onChangeOwner={beginChangeOwner}
        addUsersDisabled={!connection || !vm.canChangeViewOwners}
        onAddUsers={beginAddUsers}
        copyViewsDisabled={!connection || !vm.canChangeViewOwners}
        onCopyViews={beginCopyViews}
      />
      {!connection ? (
        <MessageBar>No active Dataverse connection. Connect to an environment to view personal views.</MessageBar>
      ) : vm.personalViewsError ? (
        <MessageBar intent="error">{vm.personalViewsError}</MessageBar>
      ) : vm.usersError ? (
        <MessageBar intent="error">{vm.usersError}</MessageBar>
      ) : vm.isLoadingUsers ? (
        <Spinner label="Loading active users..." />
      ) : vm.selectedOwnerId === null && vm.tablesError ? (
        <MessageBar intent="error">{vm.tablesError} Use Refresh personal views to retry.</MessageBar>
      ) : vm.selectedOwnerId === null && vm.isLoadingTables ? (
        <Spinner label="Loading tables..." />
      ) : !vm.canLoadPersonalViews ? (
        <MessageBar>Select a table to show personal views across all owners.</MessageBar>
      ) : vm.isLoadingPersonalViews && vm.personalViews.length === 0 ? (
        <Spinner label="Loading personal views..." />
      ) : (
        <div className={styles.split}>
          <PersonalViewsGrid
            views={vm.personalViews}
            selectedViewIds={vm.selectedViews.map((view) => view.id)}
            onSelectViews={selectViews}
            selectionDisabled={vm.accessNavigationLocked || vm.isLoadingUsers || vm.isLoadingPersonalViews}
          />
          <ViewAccessPanel
            key={vm.selectedView?.id ?? "none"}
            selectedView={vm.selectedView}
            access={vm.displayedViewAccess}
            isLoading={vm.isLoadingViewAccess}
            error={vm.viewAccessError}
            hasChanges={vm.hasAccessChanges}
            isSaving={vm.isSavingViewAccess}
            saveError={vm.viewAccessSaveError}
            onChange={changeAccess}
            onRemove={removeAccess}
            onSave={saveAccess}
            onDiscard={() => vm.discardAccessChanges()}
            availableUsers={vm.availableAccessUsers}
            hasNewUserRow={vm.hasNewUserRow}
            onAddUser={addAccessUser}
            onSelectUser={selectAccessUser}
            onCancelUser={() => vm.cancelAddAccessUser()}
          />
        </div>
      )}
      {connection && vm.ownerChangeViews.length > 0 && (
        <ViewOwnerDialog
          views={vm.ownerChangeViews}
          remainingCount={vm.pendingOwnerChangeViews.length}
          lockedOwnerId={vm.ownerChangeOwnerId}
          users={vm.availableViewOwners}
          isSaving={vm.isChangingOwner}
          error={vm.ownerChangeError}
          onSave={changeOwner}
          onCancel={() => vm.cancelChangeViewOwner()}
        />
      )}
      {connection && vm.bulkAccessViews.length > 0 && (
        <AddViewUsersDialog
          viewCount={vm.bulkAccessViews.length}
          users={vm.activeUsers}
          isSaving={vm.isSavingBulkAccess}
          inputsLocked={vm.bulkAccessTotal > 0}
          totalCount={vm.bulkAccessTotal}
          remainingCount={vm.pendingBulkAccess.length}
          error={vm.bulkAccessError}
          onSave={saveBulkAccess}
          onCancel={() => vm.cancelBulkAccess()}
        />
      )}
      {connection && vm.copySystemViews.isOpen && (
        <CopySystemViewsDialog
          copies={vm.copySystemViews.copies}
          solutions={vm.copySystemViews.solutions}
          isLoadingSolutions={vm.copySystemViews.isLoadingSolutions}
          solutionsError={vm.copySystemViews.solutionsError}
          isCopying={vm.copySystemViews.isCopying}
          lockedSolution={vm.copySystemViews.lockedSolution}
          error={vm.copySystemViews.error}
          onRetrySolutions={loadCopySolutions}
          onCopy={copyViews}
          onCancel={cancelCopyViews}
        />
      )}
      </div>
      <div
        className={styles.panel}
        id={`${tabsId}-system-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-system`}
        hidden={vm.activeTab !== "system"}
      >
        <SystemViews
          connected={!!connection}
          tables={vm.tables}
          selectedTableLogicalName={vm.selectedSystemTableLogicalName}
          tableDisabled={!connection || vm.isLoadingUsers || vm.isLoadingTables || !vm.hasLoadedTables || vm.accessNavigationLocked}
          isLoadingTables={vm.isLoadingTables || vm.isLoadingUsers}
          tablesError={vm.tablesError}
          views={vm.systemViews}
          isLoadingViews={vm.isLoadingSystemViews}
          error={vm.systemViewsError}
          refreshDisabled={!connection || vm.isLoadingUsers || vm.isLoadingTables || vm.isLoadingSystemViews
            || vm.accessNavigationLocked || (vm.selectedSystemTableLogicalName === null && !vm.tablesError)}
          onTableChange={selectSystemTable}
          onRefresh={vm.tablesError ? loadTables : loadSystemViews}
        />
      </div>
    </div>
  );
});
