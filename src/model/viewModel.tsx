import { makeAutoObservable, runInAction } from "mobx";

export interface ActiveUser {
  id: string;
  name: string;
  isCurrentUser: boolean;
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
  getPersonalViews(ownerId: string | null): Promise<PersonalView[]>;
  getViewAccess(viewId: string): Promise<ViewAccess[]>;
  updateViewAccess(viewId: string, principal: ViewAccess, mask: number): Promise<void>;
  grantViewAccess(viewId: string, principal: ViewAccess, mask: number): Promise<void>;
}

export interface dvServiceProps {
  connection: ToolBoxAPI.DataverseConnection | null;
  dvApi: DataverseAPI.API;
  onLog: (message: string, type?: "info" | "success" | "warning" | "error") => void;
}

export interface ViewStudioProps {
  connection: ToolBoxAPI.DataverseConnection | null;
  dvSvc: ViewDataService | null;
  vm: ViewModel;
  onLog: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  notifyError: (message: string) => void;
  notifySuccess: (message: string) => void;
}

export interface ViewStudioHeaderProps {
  activeUsers: ActiveUser[];
  selectedOwnerId: string | null;
  ownerDisabled: boolean;
  refreshDisabled: boolean;
  onOwnerChange: (ownerId: string | null) => void;
  onRefresh: () => Promise<void>;
}

export interface PersonalViewsGridProps {
  views: PersonalView[];
  onSelectView: (view: PersonalView | null) => Promise<void>;
  selectionDisabled: boolean;
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
  activeUsers: ActiveUser[] = [];
  personalViews: PersonalView[] = [];
  selectedOwnerId: string | null = null;
  isLoadingUsers = false;
  hasLoadedUsers = false;
  isLoadingPersonalViews = false;
  usersError: string | null = null;
  personalViewsError: string | null = null;
  selectedView: PersonalView | null = null;
  viewAccess: ViewAccess[] = [];
  isLoadingViewAccess = false;
  viewAccessError: string | null = null;
  pendingAccess = new Map<string, number>();
  newViewAccess: ViewAccess[] = [];
  hasNewUserRow = false;
  isSavingViewAccess = false;
  viewAccessSaveError: string | null = null;
  private viewAccessRequest = 0;
  private usersRequest = 0;
  private personalViewsRequest = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get hasAccessChanges(): boolean {
    return this.pendingAccess.size > 0 || this.newViewAccess.length > 0 || this.hasNewUserRow;
  }

  get accessNavigationLocked(): boolean {
    return this.hasAccessChanges || this.isSavingViewAccess;
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
    this.clearSelectedView();
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
    this.personalViews = [];
    this.personalViewsError = null;
    this.isLoadingPersonalViews = true;
  }

  async loadPersonalViews(service: ViewDataService, ownerId: string | null): Promise<void> {
    if (this.hasAccessChanges) return;
    this.clearSelectedView();
    this.personalViews = [];
    const request = ++this.personalViewsRequest;
    this.isLoadingPersonalViews = true;
    this.personalViewsError = null;

    try {
      const views = await service.getPersonalViews(ownerId);
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
