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
  saveMessage: string | null;
  onChange: (principal: ViewAccess, mask: number) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
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
  isSavingViewAccess = false;
  viewAccessSaveError: string | null = null;
  viewAccessSaveMessage: string | null = null;
  private viewAccessRequest = 0;
  private usersRequest = 0;
  private personalViewsRequest = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get hasAccessChanges(): boolean {
    return this.pendingAccess.size > 0;
  }

  get accessNavigationLocked(): boolean {
    return this.hasAccessChanges || this.isSavingViewAccess;
  }

  get displayedViewAccess(): ViewAccess[] {
    return this.viewAccess.map((principal) => ({
      ...principal,
      accessRightsMask: this.pendingAccess.get(`${principal.principalType}:${principal.id}`) ?? principal.accessRightsMask,
    }));
  }

  stageViewAccess(principal: ViewAccess, mask: number): void {
    if (this.isSavingViewAccess) throw new Error("Wait for access changes to finish saving.");
    const original = this.viewAccess.find((entry) => entry.id === principal.id && entry.principalType === principal.principalType);
    if (!this.selectedView || !original) throw new Error("Select a current view access record before editing.");
    if (!isEditableAccessMask(original.accessRightsMask) || !isEditableAccessMask(mask)) {
      throw new Error("This access mask contains unsupported rights and cannot be edited.");
    }
    const key = `${principal.principalType}:${principal.id}`;
    if (mask === original.accessRightsMask) this.pendingAccess.delete(key);
    else this.pendingAccess.set(key, mask);
    this.viewAccessSaveError = null;
    this.viewAccessSaveMessage = null;
  }

  discardAccessChanges(): void {
    if (this.isSavingViewAccess) throw new Error("Wait for access changes to finish saving.");
    this.pendingAccess.clear();
    this.viewAccessSaveError = null;
    this.viewAccessSaveMessage = null;
  }

  async saveViewAccess(service: ViewDataService): Promise<void> {
    if (this.isSavingViewAccess) return;
    if (!this.selectedView || !this.hasAccessChanges) return;
    const viewId = this.selectedView.id;
    const request = this.viewAccessRequest;
    const changes = this.viewAccess
      .filter((principal) => this.pendingAccess.has(`${principal.principalType}:${principal.id}`))
      .map((principal) => ({
        principal,
        mask: this.pendingAccess.get(`${principal.principalType}:${principal.id}`) ?? principal.accessRightsMask,
      }));
    this.isSavingViewAccess = true;
    this.viewAccessSaveError = null;
    this.viewAccessSaveMessage = null;
    let savingName = "";
    let writesComplete = false;
    try {
      for (const { principal, mask } of changes) {
        savingName = principal.name;
        await service.updateViewAccess(viewId, principal, mask);
        if (request !== this.viewAccessRequest) {
          throw new Error("The view or connection changed. Remaining access changes were not submitted.");
        }
        runInAction(() => {
          this.pendingAccess.delete(`${principal.principalType}:${principal.id}`);
          this.viewAccess = this.viewAccess.flatMap((entry) =>
            entry.id === principal.id && entry.principalType === principal.principalType
              ? mask === 0 ? [] : [{ ...entry, accessRightsMask: mask }]
              : [entry]);
        });
      }
      writesComplete = true;
      const access = await service.getViewAccess(viewId);
      if (request !== this.viewAccessRequest) return;
      runInAction(() => {
        this.viewAccess = access;
        this.viewAccessSaveMessage = "Access changes saved.";
      });
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
    this.viewAccessSaveError = null;
    this.viewAccessSaveMessage = null;
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
