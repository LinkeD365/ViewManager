import { makeAutoObservable, runInAction } from "mobx";
import { CopySystemViewsModel } from "./copySystemViewsModel";
import { CopySystemViewsToPersonalModel } from "./copySystemViewsToPersonalModel";
import { CrossEnvironmentCopyModel } from "./crossEnvironmentCopyModel";

export interface ActiveUser {
  id: string;
  name: string;
  isCurrentUser: boolean;
}

export interface EnvironmentTargetOption {
  slot: number;
  name: string;
  environment: string;
}

export interface ViewTable {
  logicalName: string;
  name: string;
}

export interface PersonalView {
  id: string;
  name: string;
  entityName: string;
  tableName: string;
  ownerId: string;
  ownerName: string;
  modifiedOn: string;
  description: string;
}

export type SystemView = Pick<PersonalView, "id" | "name" | "entityName" | "tableName" | "modifiedOn" | "description">;
export type ViewStudioTab = "personal" | "system";

export interface UnmanagedSolution {
  id: string;
  name: string;
  uniqueName: string;
  version: string;
}

export interface SystemViewDefinition {
  name: string;
  returnedtypecode: string;
  fetchxml: string;
  layoutxml: string;
  description?: string;
  columnsetxml?: string;
  layoutjson?: string;
  conditionalformatting?: string;
  advancedgroupby?: string;
}

export interface SystemViewCopy {
  source: PersonalView;
  systemViewId: string;
  definition: SystemViewDefinition | null;
  created: boolean;
  added: boolean;
}

export interface PersonalViewCopy {
  source: SystemView;
  personalViewId: string;
  definition: SystemViewDefinition | null;
  completed: boolean;
}

export interface PersonalEnvironmentCopy {
  source: PersonalView;
  destinationSlot: number;
  targetViewId: string;
  definition: SystemViewDefinition | null;
  completed: boolean;
}

export interface SystemEnvironmentCopy {
  source: SystemView;
  destinationSlot: number;
  targetViewId: string;
  definition: SystemViewDefinition | null;
  created: boolean;
  added: boolean;
}

export type CrossEnvironmentCopyKind = "personal" | "system";

export interface CrossEnvironmentDestination extends EnvironmentTargetOption {
  users: ActiveUser[];
  solutions: UnmanagedSolution[];
  isLoading: boolean;
  error: string | null;
  selectedOwnerId: string | null;
  lockedOwnerId: string | null;
  selectedSolution: string | null;
  lockedSolution: string | null;
}

export interface CrossEnvironmentCopyDialogProps {
  kind: CrossEnvironmentCopyKind;
  sourceCount: number;
  sourceViews: Array<Pick<PersonalView, "id" | "name" | "tableName">>;
  targets: EnvironmentTargetOption[];
  selectedTargetSlots: number[];
  isTargetsLocked: boolean;
  personalCopies: PersonalEnvironmentCopy[];
  systemCopies: SystemEnvironmentCopy[];
  destinations: CrossEnvironmentDestination[];
  isLoadingOptions: boolean;
  optionsError: string | null;
  isCopying: boolean;
  error: string | null;
  onTargetsChange: (targetSlots: number[]) => void;
  onOwnerChange: (slot: number, ownerId: string | null) => void;
  onSolutionChange: (slot: number, uniqueName: string | null) => void;
  onRetryOptions: () => Promise<void>;
  onCopy: () => Promise<void>;
  onCancel: () => void;
}

export interface ViewAccess {
  id: string;
  name: string;
  principalType: "User" | "Team";
  accessRightsMask: number;
}

export const accessRights = [
  [1, "Read", "ReadAccess"],
  [2, "Write", "WriteAccess"],
  [4, "Append", "AppendAccess"],
  [16, "Append to", "AppendToAccess"],
  [32, "Create", "CreateAccess"],
  [65536, "Delete", "DeleteAccess"],
  [262144, "Share", "ShareAccess"],
  [524288, "Assign", "AssignAccess"],
] as const;

export const knownAccessRightsMask = accessRights.reduce((mask, [value]) => mask | value, 0);

export const selectableAccessRights = accessRights.filter(([value]) => value !== 4 && value !== 16 && value !== 32);
export const selectableAccessRightsMask = selectableAccessRights.reduce((mask, [value]) => mask | value, 0);

export function getAccessMaskFromSelection(currentMask: number, selectedOptions: string[]): number {
  return selectableAccessRights.reduce((mask, [value]) =>
    selectedOptions.includes(String(value)) ? mask | value : mask,
  currentMask & ~selectableAccessRightsMask);
}

export function isEditableAccessMask(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && mask <= knownAccessRightsMask
    && (mask & knownAccessRightsMask) === mask;
}

export function formatAccessRights(mask: number): string {
  if (mask === 0) return "None";
  const labels: string[] = [];
  let remaining = mask;
  for (const [value, label] of accessRights) {
    if ((mask & value) !== 0) {
      labels.push(label);
      remaining -= value;
    }
  }
  if (remaining !== 0) labels.push(`Unknown rights (${remaining})`);
  return labels.join(", ");
}

export interface ViewDataService {
  getActiveUsers(): Promise<ActiveUser[]>;
  getTables(): Promise<ViewTable[]>;
  getPersonalViews(ownerId: string | null, tableLogicalName?: string | null): Promise<PersonalView[]>;
  getSystemViews(tableLogicalName: string): Promise<SystemView[]>;
  getUnmanagedSolutions(): Promise<UnmanagedSolution[]>;
  getPersonalViewDefinition(viewId: string): Promise<SystemViewDefinition>;
  getSystemViewDefinition(viewId: string): Promise<SystemViewDefinition>;
  systemViewExists(viewId: string): Promise<boolean>;
  personalViewExists(viewId: string): Promise<boolean>;
  createSystemView(viewId: string, definition: SystemViewDefinition): Promise<void>;
  createPersonalView(viewId: string, definition: SystemViewDefinition, ownerId: string): Promise<void>;
  addSystemViewToSolution(viewId: string, solutionUniqueName: string): Promise<void>;
  getViewAccess(viewId: string): Promise<ViewAccess[]>;
  getUserViewAccessMask(viewId: string, userId: string): Promise<number>;
  updateViewAccess(viewId: string, principal: ViewAccess, mask: number): Promise<void>;
  grantViewAccess(viewId: string, principal: ViewAccess, mask: number): Promise<void>;
  changeViewOwner(viewId: string, ownerId: string): Promise<void>;
}

export interface dvServiceProps {
  connection: ToolBoxAPI.DataverseConnection | null;
  dvApi: DataverseAPI.API;
  onLog: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  connectionTarget?: ToolBoxAPI.ConnectionTarget;
}

export interface ViewStudioProps {
  connections: Array<ToolBoxAPI.DataverseConnection | null>;
  connectionServices: Array<ViewDataService | null>;
  vm: ViewModel;
  onLog: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
}

export interface ViewStudioHeaderProps {
  activeUsers: ActiveUser[];
  selectedOwnerId: string | null;
  tables: ViewTable[];
  selectedTableLogicalName: string | null;
  tableDisabled: boolean;
  ownerDisabled: boolean;
  refreshDisabled: boolean;
  changeOwnerDisabled: boolean;
  addUsersDisabled: boolean;
  copyViewsDisabled: boolean;
  copyToEnvironmentDisabled: boolean;
  selectedViewCount: number;
  onChangeOwner: () => void;
  onAddUsers: () => void;
  onCopyViews: () => void;
  onCopyViewsToEnvironment: () => void;
  onOwnerChange: (ownerId: string | null) => void;
  onTableChange: (logicalName: string) => void;
  onRefresh: () => Promise<void>;
}

export interface PersonalViewsGridProps {
  views: PersonalView[];
  selectedViewIds: string[];
  onSelectViews: (views: PersonalView[]) => Promise<void>;
  selectionDisabled: boolean;
}

export interface SystemViewsProps {
  connected: boolean;
  tables: ViewTable[];
  selectedTableLogicalName: string | null;
  tableDisabled: boolean;
  isLoadingTables: boolean;
  tablesError: string | null;
  views: SystemView[];
  selectedViewIds: string[];
  isLoadingViews: boolean;
  error: string | null;
  refreshDisabled: boolean;
  copyDisabled: boolean;
  copyToEnvironmentDisabled: boolean;
  onTableChange: (logicalName: string) => void;
  onSelectViews: (views: SystemView[]) => void;
  onRefresh: () => Promise<void>;
  onCopyToPersonal: () => void;
  onCopyToEnvironment: () => void;
}

export interface CopySystemViewToPersonalDialogProps {
  copies: PersonalViewCopy[];
  users: ActiveUser[];
  selectedOwnerId: string | null;
  lockedOwnerId: string | null;
  isCopying: boolean;
  error: string | null;
  onOwnerChange: (ownerId: string | null) => void;
  onCopy: () => Promise<void>;
  onCancel: () => void;
}

export interface ViewOwnerDialogProps {
  views: PersonalView[];
  remainingCount: number;
  lockedOwnerId: string | null;
  users: ActiveUser[];
  isSaving: boolean;
  error: string | null;
  onSave: (ownerId: string) => Promise<void>;
  onCancel: () => void;
}

export interface CopySystemViewsDialogProps {
  copies: SystemViewCopy[];
  solutions: UnmanagedSolution[];
  isLoadingSolutions: boolean;
  solutionsError: string | null;
  isCopying: boolean;
  lockedSolution: string | null;
  error: string | null;
  onRetrySolutions: () => Promise<void>;
  onCopy: (uniqueName: string) => Promise<void>;
  onCancel: () => void;
}

export interface BulkViewAccessTarget {
  view: PersonalView;
  principal: ViewAccess;
}

export interface AddViewUsersDialogProps {
  viewCount: number;
  users: ActiveUser[];
  isSaving: boolean;
  inputsLocked: boolean;
  totalCount: number;
  remainingCount: number;
  error: string | null;
  onSave: (userIds: string[], mask: number) => Promise<void>;
  onCancel: () => void;
}

export interface ViewAccessPanelProps {
  selectedView: PersonalView | null;
  access: ViewAccess[];
  isLoading: boolean;
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  saveError: string | null;
  onChange: (principal: ViewAccess, mask: number) => void;
  onRemove: (principal: ViewAccess) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  availableUsers: ActiveUser[];
  hasNewUserRow: boolean;
  onAddUser: () => boolean;
  onSelectUser: (userId: string) => void;
  onCancelUser: () => void;
}

export interface NewViewAccessRow {
  isNewUserRow: true;
}

export type ViewAccessGridRow = ViewAccess | NewViewAccessRow;

export interface ViewAccessUserPickerProps {
  users: ActiveUser[];
  onSelect: (userId: string) => void;
  onCancel: () => void;
}

export interface ViewAccessEditorProps {
  principal: ViewAccess;
  onChange: (mask: number) => void;
  onClose: () => void;
}

export class ViewModel {
  copySystemViews = new CopySystemViewsModel();
  copySystemViewToPersonal = new CopySystemViewsToPersonalModel();
  crossEnvironmentCopy = new CrossEnvironmentCopyModel();
  activeTab: ViewStudioTab = "personal";
  systemViews: SystemView[] = [];
  selectedSystemViews: SystemView[] = [];
  selectedSystemTableLogicalName: string | null = null;
  isLoadingSystemViews = false;
  systemViewsError: string | null = null;
  private systemViewsRequest = 0;
  activeUsers: ActiveUser[] = [];
  tables: ViewTable[] = [];
  selectedTableLogicalName: string | null = null;
  isLoadingTables = false;
  hasLoadedTables = false;
  tablesError: string | null = null;
  personalViews: PersonalView[] = [];
  selectedOwnerId: string | null = null;
  isLoadingUsers = false;
  hasLoadedUsers = false;
  isLoadingPersonalViews = false;
  usersError: string | null = null;
  personalViewsError: string | null = null;
  selectedView: PersonalView | null = null;
  selectedViews: PersonalView[] = [];
  viewAccess: ViewAccess[] = [];
  isLoadingViewAccess = false;
  viewAccessError: string | null = null;
  pendingAccess = new Map<string, number>();
  newViewAccess: ViewAccess[] = [];
  hasNewUserRow = false;
  isSavingViewAccess = false;
  viewAccessSaveError: string | null = null;
  ownerChangeViews: PersonalView[] = [];
  pendingOwnerChangeViews: PersonalView[] = [];
  ownerChangeOwnerId: string | null = null;
  isChangingOwner = false;
  ownerChangeError: string | null = null;
  bulkAccessViews: PersonalView[] = [];
  pendingBulkAccess: BulkViewAccessTarget[] = [];
  bulkAccessUserIds: string[] = [];
  bulkAccessMask = 1;
  bulkAccessTotal = 0;
  isSavingBulkAccess = false;
  bulkAccessError: string | null = null;
  private bulkAccessRequest = 0;
  private ownerChangeRequest = 0;
  private viewAccessRequest = 0;
  private usersRequest = 0;
  private tablesRequest = 0;
  private personalViewsRequest = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get hasAccessChanges(): boolean {
    return this.pendingAccess.size > 0 || this.newViewAccess.length > 0 || this.hasNewUserRow;
  }

  get accessNavigationLocked(): boolean {
    return this.hasAccessChanges || this.isSavingViewAccess || this.ownerChangeViews.length > 0 || this.isChangingOwner
      || this.bulkAccessViews.length > 0 || this.isSavingBulkAccess
      || this.copySystemViews.isOpen || this.copySystemViews.isCopying
      || this.copySystemViewToPersonal.isOpen || this.copySystemViewToPersonal.isCopying
      || this.crossEnvironmentCopy.isOpen || this.crossEnvironmentCopy.isCopying;
  }

  get canChangeViewOwners(): boolean {
    return this.selectedViews.length >= 1 && !this.accessNavigationLocked
      && !this.isLoadingUsers && !this.isLoadingPersonalViews;
  }

  beginCopySystemViews(): void {
    if (this.activeTab !== "personal" || !this.canChangeViewOwners) {
      throw new Error("Select one or more personal views and finish or discard existing changes before copying.");
    }
    const ids = new Set(this.selectedViews.map((view) => view.id));
    const views = this.personalViews.filter((view) => ids.has(view.id));
    if (views.length !== ids.size) throw new Error("Select views from the current view listing.");
    this.copySystemViews.begin(views);
  }

  setActiveTab(tab: ViewStudioTab): void {
    if (this.accessNavigationLocked) return;
    this.activeTab = tab;
  }

  resetSystemViews(): void {
    this.systemViewsRequest++;
    this.systemViews = [];
    this.selectedSystemViews = [];
    this.selectedSystemTableLogicalName = null;
    this.isLoadingSystemViews = false;
    this.systemViewsError = null;
  }

  setSelectedSystemTable(logicalName: string): void {
    if (this.accessNavigationLocked) return;
    if (logicalName === this.selectedSystemTableLogicalName) return;
    if (!this.tables.some((table) => table.logicalName === logicalName)) {
      throw new Error("Select an available Dataverse table.");
    }
    this.systemViewsRequest++;
    this.selectedSystemTableLogicalName = logicalName;
    this.systemViews = [];
    this.selectedSystemViews = [];
    this.systemViewsError = null;
    this.isLoadingSystemViews = true;
  }

  async loadSystemViews(service: ViewDataService): Promise<void> {
    const tableLogicalName = this.selectedSystemTableLogicalName;
    if (tableLogicalName === null) return;
    const request = ++this.systemViewsRequest;
    this.systemViews = [];
    this.selectedSystemViews = [];
    this.systemViewsError = null;
    this.isLoadingSystemViews = true;
    try {
      const views = await service.getSystemViews(tableLogicalName);
      runInAction(() => {
        if (request !== this.systemViewsRequest) return;
        this.systemViews = views;
      });
    } catch (error) {
      if (request !== this.systemViewsRequest) return;
      runInAction(() => {
        this.systemViewsError = error instanceof Error ? error.message : "Unable to load system views.";
      });
      throw error;
    } finally {
      runInAction(() => {
        if (request === this.systemViewsRequest) this.isLoadingSystemViews = false;
      });
    }
  }

  beginCopySystemViewToPersonal(): void {
    if (this.activeTab !== "system" || this.accessNavigationLocked || this.isLoadingSystemViews) {
      throw new Error("Finish or discard existing changes before copying system views.");
    }
    const ids = new Set(this.selectedSystemViews.map((view) => view.id));
    const sources = this.systemViews.filter((view) => ids.has(view.id));
    if (sources.length !== ids.size || sources.length === 0) {
      throw new Error("Select one or more system views from the current listing.");
    }
    this.copySystemViewToPersonal.begin(sources);
  }

  selectSystemViews(views: SystemView[]): void {
    if (this.accessNavigationLocked || this.isLoadingSystemViews) return;
    const ids = new Set(views.map((view) => view.id));
    const currentViews = this.systemViews.filter((view) => ids.has(view.id));
    if (currentViews.length !== ids.size) throw new Error("Select system views from the current listing.");
    this.selectedSystemViews = currentViews;
  }

  beginAddUsersToViews(): void {
    if (!this.canChangeViewOwners) {
      throw new Error("Select one or more views and finish or discard existing changes before adding users.");
    }
    const ids = new Set(this.selectedViews.map((view) => view.id));
    const views = this.personalViews.filter((view) => ids.has(view.id));
    if (views.length !== ids.size) throw new Error("Select views from the current view listing.");
    this.resetBulkAccess();
    this.bulkAccessViews = views;
  }

  cancelBulkAccess(): void {
    if (this.isSavingBulkAccess) return;
    this.resetBulkAccess();
  }

  resetBulkAccess(): void {
    this.bulkAccessRequest++;
    this.bulkAccessViews = [];
    this.pendingBulkAccess = [];
    this.bulkAccessUserIds = [];
    this.bulkAccessMask = 1;
    this.bulkAccessTotal = 0;
    this.isSavingBulkAccess = false;
    this.bulkAccessError = null;
  }

  async saveBulkViewAccess(service: ViewDataService, userIds: string[], mask: number): Promise<boolean> {
    if (this.isSavingBulkAccess) return false;
    if (this.bulkAccessViews.length === 0) throw new Error("Select views and open Add users before applying access.");
    if (this.hasAccessChanges || this.isSavingViewAccess || this.ownerChangeViews.length > 0) {
      throw new Error("Finish or discard existing changes before adding users.");
    }
    const ids = new Set(userIds.map((id) => id.toLowerCase()));
    const users = this.activeUsers.filter((user) => ids.has(user.id.toLowerCase()));
    if (ids.size === 0 || users.length !== ids.size) throw new Error("Select one or more available users.");
    if (!isEditableAccessMask(mask) || mask === 0 || (mask & ~selectableAccessRightsMask) !== 0) {
      throw new Error("Select at least one supported permission before applying access.");
    }
    if (this.bulkAccessTotal > 0) {
      if (mask !== this.bulkAccessMask || ids.size !== this.bulkAccessUserIds.length
        || this.bulkAccessUserIds.some((id) => !ids.has(id.toLowerCase()))) {
        throw new Error("Retry with the same users and permissions, or close this operation.");
      }
    } else {
      this.bulkAccessUserIds = users.map((user) => user.id);
      this.bulkAccessMask = mask;
      this.pendingBulkAccess = this.bulkAccessViews.flatMap((view) => users.map((user) => ({
        view,
        principal: { id: user.id, name: user.name, principalType: "User", accessRightsMask: mask },
      })));
      this.bulkAccessTotal = this.pendingBulkAccess.length;
    }
    const request = ++this.bulkAccessRequest;
    const targets = [...this.pendingBulkAccess];
    const filterOwnerId = this.selectedOwnerId;
    const tableLogicalName = filterOwnerId === null ? this.selectedTableLogicalName : null;
    this.isSavingBulkAccess = true;
    this.bulkAccessError = null;
    let writesComplete = false;
    let savingName = "";
    try {
      for (const { view, principal } of targets) {
        savingName = `${principal.name} on "${view.name}"`;
        const existingMask = await service.getUserViewAccessMask(view.id, principal.id);
        if (request !== this.bulkAccessRequest) return false;
        if (existingMask === 0) {
          await service.grantViewAccess(view.id, principal, mask);
        } else {
          await service.updateViewAccess(view.id, principal, mask);
        }
        if (request !== this.bulkAccessRequest) return false;
        runInAction(() => {
          this.clearSelectedView();
          this.pendingBulkAccess = this.pendingBulkAccess.filter((target) =>
            target.view.id !== view.id || target.principal.id !== principal.id);
        });
      }
      writesComplete = true;
      const views = await service.getPersonalViews(filterOwnerId, tableLogicalName);
      if (request !== this.bulkAccessRequest) return false;
      runInAction(() => {
        this.personalViews = views;
        this.personalViewsError = null;
        this.bulkAccessViews = [];
      });
      return true;
    } catch (error) {
      if (request !== this.bulkAccessRequest) return false;
      const detail = error instanceof Error ? error.message : String(error);
      const completed = this.bulkAccessTotal - this.pendingBulkAccess.length;
      const message = writesComplete
        ? `Access was saved, but reloading views failed: ${detail}. Refresh the personal views to reload.`
        : `Unable to apply access for ${savingName}: ${detail}. ${completed} of ${this.bulkAccessTotal} user/view changes completed; ${this.pendingBulkAccess.length} remain. Retry applies only to the remaining changes.`;
      runInAction(() => {
        if (writesComplete) {
          this.bulkAccessViews = [];
          this.personalViewsError = message;
        } else {
          this.bulkAccessError = message;
        }
      });
      throw new Error(message);
    } finally {
      runInAction(() => {
        if (request === this.bulkAccessRequest) this.isSavingBulkAccess = false;
      });
    }
  }

  get availableViewOwners(): ActiveUser[] {
    return this.activeUsers.filter((user) =>
      this.ownerChangeViews.some((view) => user.id.toLowerCase() !== view.ownerId.toLowerCase()));
  }

  beginChangeViewOwner(views: PersonalView[] = this.selectedViews): void {
    if (this.accessNavigationLocked || this.isLoadingUsers || this.isLoadingPersonalViews) {
      throw new Error("Finish the current operation or discard access changes before changing a view's owner.");
    }
    const ids = new Set(views.map((view) => view.id));
    const currentViews = this.personalViews.filter((view) => ids.has(view.id));
    if (ids.size === 0 || currentViews.length !== ids.size) {
      throw new Error("Select views from the current view listing.");
    }
    this.ownerChangeViews = currentViews;
    this.pendingOwnerChangeViews = currentViews;
    this.ownerChangeOwnerId = null;
    this.ownerChangeError = null;
  }

  cancelChangeViewOwner(): void {
    if (this.isChangingOwner) return;
    this.resetOwnerChange();
  }

  resetOwnerChange(): void {
    this.ownerChangeRequest++;
    this.ownerChangeViews = [];
    this.pendingOwnerChangeViews = [];
    this.ownerChangeOwnerId = null;
    this.ownerChangeError = null;
    this.isChangingOwner = false;
  }

  async changeViewOwner(service: ViewDataService, ownerId: string): Promise<boolean> {
    if (this.isChangingOwner) return false;
    const targets = [...this.pendingOwnerChangeViews];
    const total = this.ownerChangeViews.length;
    const owner = this.availableViewOwners.find((user) => user.id === ownerId);
    if (targets.length === 0 || !owner) throw new Error("Select a different available user as the new owner.");
    if (this.ownerChangeOwnerId !== null && this.ownerChangeOwnerId !== owner.id) {
      throw new Error("Retry with the same owner for the remaining views, or close this operation.");
    }
    if (this.hasAccessChanges || this.isSavingViewAccess) {
      throw new Error("Save or discard access changes before changing a view's owner.");
    }
    const request = ++this.ownerChangeRequest;
    const filterOwnerId = this.selectedOwnerId;
    const tableLogicalName = filterOwnerId === null ? this.selectedTableLogicalName : null;
    this.isChangingOwner = true;
    this.ownerChangeOwnerId = owner.id;
    this.ownerChangeError = null;
    let writesComplete = false;
    let assigningName = "";
    try {
      for (const view of targets) {
        assigningName = view.name;
        if (view.ownerId.toLowerCase() !== owner.id.toLowerCase()) {
          await service.changeViewOwner(view.id, owner.id);
        }
        if (request !== this.ownerChangeRequest) return false;
        runInAction(() => {
          this.clearSelectedView();
          this.personalViews = this.personalViews.flatMap((entry) =>
            entry.id !== view.id ? [entry]
              : filterOwnerId !== null && filterOwnerId.toLowerCase() !== owner.id.toLowerCase()
                ? [] : [{ ...entry, ownerId: owner.id, ownerName: owner.name }]);
          this.pendingOwnerChangeViews = this.pendingOwnerChangeViews.filter((entry) => entry.id !== view.id);
        });
      }
      writesComplete = true;
      const views = await service.getPersonalViews(filterOwnerId, tableLogicalName);
      if (request !== this.ownerChangeRequest) return false;
      runInAction(() => {
        this.personalViews = views;
        this.personalViewsError = null;
        this.ownerChangeViews = [];
        this.ownerChangeOwnerId = null;
      });
      return true;
    } catch (error) {
      if (request !== this.ownerChangeRequest) return false;
      const detail = error instanceof Error ? error.message : String(error);
      const completed = total - this.pendingOwnerChangeViews.length;
      const failureDetail =
        /\bprvReadUserQuery\b/i.test(detail) && /0x80042f09|has not been assigned any roles/i.test(detail)
          ? "The user doesn't have the appropriate security group to allow read to user views"
          : total === 1 ? `Unable to change the view's owner: ${detail}`
            : `Unable to change owner for "${assigningName}": ${detail}`;
      const message = writesComplete
        ? `${total === 1 ? "The owner was changed" : "The owners were changed"}, but reloading views failed: ${detail}. Refresh the personal views to reload.`
        : total === 1 ? failureDetail
          : `${failureDetail}. ${completed} of ${total} views completed; ${this.pendingOwnerChangeViews.length} remain. Retry applies only to the remaining views.`;
      runInAction(() => {
        if (writesComplete) {
          this.ownerChangeViews = [];
          this.ownerChangeOwnerId = null;
          this.personalViewsError = message;
        } else {
          this.ownerChangeError = message;
          if (completed === 0) this.ownerChangeOwnerId = null;
        }
      });
      throw new Error(message);
    } finally {
      runInAction(() => {
        if (request === this.ownerChangeRequest) this.isChangingOwner = false;
      });
    }
  }

  get canLoadPersonalViews(): boolean {
    return this.selectedOwnerId !== null || this.selectedTableLogicalName !== null;
  }

  get displayedViewAccess(): ViewAccess[] {
    return [
      ...this.viewAccess
        .filter((principal) => this.pendingAccess.get(`${principal.principalType}:${principal.id}`) !== 0)
        .map((principal) => ({
          ...principal,
          accessRightsMask: this.pendingAccess.get(`${principal.principalType}:${principal.id}`) ?? principal.accessRightsMask,
        })),
      ...this.newViewAccess,
    ];
  }

  get availableAccessUsers(): ActiveUser[] {
    const existing = new Set(this.displayedViewAccess
      .filter((principal) => principal.principalType === "User")
      .map((principal) => principal.id.toLowerCase()));
    return this.activeUsers.filter((user) => !existing.has(user.id.toLowerCase()));
  }

  beginAddAccessUser(): void {
    if (!this.selectedView || this.isLoadingViewAccess || this.viewAccessError || this.isSavingViewAccess) {
      throw new Error("Wait until a view's access records are ready before adding a user.");
    }
    if (this.availableAccessUsers.length === 0) throw new Error("There are no available users to add.");
    this.hasNewUserRow = true;
    this.viewAccessSaveError = null;
  }

  selectAccessUser(userId: string): void {
    if (!this.hasNewUserRow || this.isSavingViewAccess) throw new Error("Add a new user row before selecting a user.");
    const user = this.availableAccessUsers.find((entry) => entry.id.toLowerCase() === userId.toLowerCase());
    if (!user) throw new Error("This user is unavailable or is already in the access grid.");
    this.newViewAccess.push({ id: user.id, name: user.name, principalType: "User", accessRightsMask: 1 });
    this.hasNewUserRow = false;
  }

  cancelAddAccessUser(): void {
    this.hasNewUserRow = false;
  }

  stageViewAccess(principal: ViewAccess, mask: number): void {
    if (this.isSavingViewAccess) throw new Error("Wait for access changes to finish saving.");
    const newPrincipal = this.newViewAccess.find((entry) => entry.id === principal.id && entry.principalType === principal.principalType);
    if (newPrincipal) {
      if (!isEditableAccessMask(mask)) throw new Error("This access mask contains unsupported rights and cannot be edited.");
      if (mask === 0) {
        this.newViewAccess = this.newViewAccess.filter((entry) => entry !== newPrincipal);
      } else {
        this.newViewAccess = this.newViewAccess.map((entry) =>
          entry === newPrincipal ? { ...entry, accessRightsMask: mask } : entry);
      }
      this.viewAccessSaveError = null;
      return;
    }
    const original = this.viewAccess.find((entry) => entry.id === principal.id && entry.principalType === principal.principalType);
    if (!this.selectedView || !original) throw new Error("Select a current view access record before editing.");
    if (!isEditableAccessMask(original.accessRightsMask) || !isEditableAccessMask(mask)) {
      throw new Error("This access mask contains unsupported rights and cannot be edited.");
    }
    const key = `${principal.principalType}:${principal.id}`;
    if (mask === original.accessRightsMask) this.pendingAccess.delete(key);
    else this.pendingAccess.set(key, mask);
    this.viewAccessSaveError = null;
  }

  removeViewAccess(principal: ViewAccess): void {
    if (this.isSavingViewAccess) throw new Error("Wait for access changes to finish saving.");
    if (!this.selectedView || principal.principalType !== "User") {
      throw new Error("Select a user in the current view before removing access.");
    }
    const added = this.newViewAccess.find((entry) => entry.id === principal.id);
    if (added) {
      this.stageViewAccess(added, 0);
      return;
    }
    const original = this.viewAccess.find((entry) => entry.id === principal.id && entry.principalType === "User");
    if (!original) throw new Error("This user is no longer in the current access grid.");
    this.pendingAccess.set(`User:${original.id}`, 0);
    this.viewAccessSaveError = null;
  }

  discardAccessChanges(): void {
    if (this.isSavingViewAccess) throw new Error("Wait for access changes to finish saving.");
    this.pendingAccess.clear();
    this.newViewAccess = [];
    this.hasNewUserRow = false;
    this.viewAccessSaveError = null;
  }

  async saveViewAccess(service: ViewDataService): Promise<boolean> {
    if (this.isSavingViewAccess) return false;
    if (!this.selectedView || !this.hasAccessChanges) return false;
    if (this.hasNewUserRow) throw new Error("Choose a user for the new row or cancel it before saving.");
    const viewId = this.selectedView.id;
    const request = this.viewAccessRequest;
    const changes = this.viewAccess
      .filter((principal) => this.pendingAccess.has(`${principal.principalType}:${principal.id}`))
      .map((principal) => ({
        principal,
        mask: this.pendingAccess.get(`${principal.principalType}:${principal.id}`) ?? principal.accessRightsMask,
        isNew: false,
      })).concat(this.newViewAccess.map((principal) => ({
        principal, mask: principal.accessRightsMask, isNew: true,
      })));
    this.isSavingViewAccess = true;
    this.viewAccessSaveError = null;
    let savingName = "";
    let writesComplete = false;
    try {
      for (const { principal, mask, isNew } of changes) {
        savingName = principal.name;
        if (isNew) await service.grantViewAccess(viewId, principal, mask);
        else await service.updateViewAccess(viewId, principal, mask);
        if (request !== this.viewAccessRequest) {
          throw new Error("The view or connection changed. Remaining access changes were not submitted.");
        }
        runInAction(() => {
          if (isNew) {
            this.newViewAccess = this.newViewAccess.filter((entry) => entry.id !== principal.id);
            this.viewAccess = [...this.viewAccess, { ...principal, accessRightsMask: mask }];
            return;
          }
          this.pendingAccess.delete(`${principal.principalType}:${principal.id}`);
          this.viewAccess = this.viewAccess.flatMap((entry) =>
            entry.id === principal.id && entry.principalType === principal.principalType
              ? mask === 0 ? [] : [{ ...entry, accessRightsMask: mask }]
              : [entry]);
        });
      }
      writesComplete = true;
      const access = await service.getViewAccess(viewId);
      if (request !== this.viewAccessRequest) return false;
      runInAction(() => {
        this.viewAccess = access;
      });
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = writesComplete
        ? `Access changes were saved, but reloading access failed: ${detail}. Refresh the views to reload.`
        : `Unable to save access for ${savingName}: ${detail}. Earlier changes may already be saved; remaining edits have not been saved.`;
      runInAction(() => {
        if (request === this.viewAccessRequest) this.viewAccessSaveError = message;
      });
      throw new Error(message);
    } finally {
      runInAction(() => { this.isSavingViewAccess = false; });
    }
  }

  async loadUsers(service: ViewDataService): Promise<void> {
    this.resetSystemViews();
    this.resetOwnerChange();
    this.resetBulkAccess();
    this.copySystemViews.reset();
    this.copySystemViewToPersonal.reset();
    this.crossEnvironmentCopy.reset();
    this.clearSelectedView();
    this.tablesRequest++;
    this.tables = [];
    this.selectedTableLogicalName = null;
    this.hasLoadedTables = false;
    this.isLoadingTables = false;
    this.tablesError = null;
    this.personalViewsRequest++;
    this.personalViews = [];
    this.isLoadingPersonalViews = false;
    const request = ++this.usersRequest;
    this.isLoadingUsers = true;
    this.usersError = null;

    try {
      const users = await service.getActiveUsers();
      runInAction(() => {
        if (request !== this.usersRequest) return;
        this.activeUsers = users;
        if (this.selectedOwnerId === null) {
          this.selectedOwnerId = users.find((user) => user.isCurrentUser)?.id ?? null;
        }
        this.hasLoadedUsers = true;
        this.isLoadingUsers = false;
      });
    } catch (error) {
      runInAction(() => {
        if (request !== this.usersRequest) return;
        this.isLoadingUsers = false;
        this.usersError = error instanceof Error ? error.message : "Unable to load active users.";
      });
      throw error;
    }
  }

  setSelectedOwner(ownerId: string | null): void {
    if (this.accessNavigationLocked) return;
    if (ownerId === this.selectedOwnerId) return;
    this.clearSelectedView();
    this.personalViewsRequest++;
    this.selectedOwnerId = ownerId;
    this.selectedTableLogicalName = null;
    this.personalViews = [];
    this.personalViewsError = null;
    this.isLoadingPersonalViews = this.canLoadPersonalViews;
  }

  async loadTables(service: ViewDataService): Promise<void> {
    if (this.hasLoadedTables || this.isLoadingTables) return;
    const request = ++this.tablesRequest;
    this.isLoadingTables = true;
    this.tablesError = null;
    try {
      const tables = await service.getTables();
      runInAction(() => {
        if (request !== this.tablesRequest) return;
        this.tables = tables;
        this.hasLoadedTables = true;
      });
    } catch (error) {
      if (request !== this.tablesRequest) return;
      runInAction(() => {
        this.tablesError = error instanceof Error ? error.message : "Unable to load tables.";
      });
      throw error;
    } finally {
      runInAction(() => {
        if (request === this.tablesRequest) this.isLoadingTables = false;
      });
    }
  }

  setSelectedTable(logicalName: string): void {
    if (this.accessNavigationLocked || this.selectedOwnerId !== null) return;
    if (logicalName === this.selectedTableLogicalName) return;
    if (!this.tables.some((table) => table.logicalName === logicalName)) {
      throw new Error("Select an available Dataverse table.");
    }
    this.clearSelectedView();
    this.personalViewsRequest++;
    this.selectedTableLogicalName = logicalName;
    this.personalViews = [];
    this.personalViewsError = null;
    this.isLoadingPersonalViews = true;
  }

  async loadPersonalViews(service: ViewDataService, ownerId: string | null): Promise<void> {
    if (this.accessNavigationLocked) return;
    this.clearSelectedView();
    this.personalViews = [];
    const request = ++this.personalViewsRequest;
    const tableLogicalName = ownerId === null ? this.selectedTableLogicalName : null;
    this.isLoadingPersonalViews = ownerId !== null || tableLogicalName !== null;
    this.personalViewsError = null;
    if (!this.isLoadingPersonalViews) return;

    try {
      const views = await service.getPersonalViews(ownerId, tableLogicalName);
      runInAction(() => {
        if (request !== this.personalViewsRequest) return;
        this.personalViews = views;
        this.isLoadingPersonalViews = false;
      });
    } catch (error) {
      runInAction(() => {
        if (request !== this.personalViewsRequest) return;
        this.isLoadingPersonalViews = false;
        this.personalViewsError =
          error instanceof Error ? error.message : "Unable to load personal views.";
      });
      throw error;
    }
  }

  clearSelectedView(): void {
    this.selectedViews = [];
    this.pendingAccess.clear();
    this.newViewAccess = [];
    this.hasNewUserRow = false;
    this.viewAccessSaveError = null;
    this.viewAccessRequest++;
    this.selectedView = null;
    this.viewAccess = [];
    this.viewAccessError = null;
    this.isLoadingViewAccess = false;
  }

  async selectViews(service: ViewDataService, views: PersonalView[]): Promise<void> {
    if (this.accessNavigationLocked || this.isLoadingUsers || this.isLoadingPersonalViews) return;
    const ids = new Set(views.map((view) => view.id));
    const currentViews = this.personalViews.filter((view) => ids.has(view.id));
    if (currentViews.length !== ids.size) throw new Error("Select views from the current view listing.");
    const loading = this.selectView(service, currentViews.length === 1 ? currentViews[0] : null);
    this.selectedViews = currentViews;
    await loading;
  }

  async selectView(service: ViewDataService, view: PersonalView | null): Promise<void> {
    if (this.accessNavigationLocked) return;
    if (view?.id === this.selectedView?.id) return;
    this.clearSelectedView();
    if (!view) return;
    this.selectedView = view;
    this.isLoadingViewAccess = true;
    const request = this.viewAccessRequest;
    try {
      const access = await service.getViewAccess(view.id);
      runInAction(() => {
        if (request !== this.viewAccessRequest) return;
        this.viewAccess = access;
        this.isLoadingViewAccess = false;
      });
    } catch (error) {
      
      if (request !== this.viewAccessRequest) return;
      runInAction(() => {
        this.isLoadingViewAccess = false;
        this.viewAccessError = error instanceof Error ? error.message : "Unable to load view access.";

      });
      throw error;
    }
  }
}
