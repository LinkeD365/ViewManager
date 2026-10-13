import { makeAutoObservable, runInAction } from "mobx";
import type { ActiveUser, PersonalViewCopy, SystemView, ViewDataService } from "./viewModel";

export class CopySystemViewsToPersonalModel {
  copies: PersonalViewCopy[] = [];
  selectedOwnerId: string | null = null;
  lockedOwnerId: string | null = null;
  isCopying = false;
  error: string | null = null;
  private request = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get isOpen(): boolean {
    return this.copies.length > 0;
  }

  begin(sources: SystemView[]): void {
    if (this.isOpen || this.isCopying) throw new Error("Finish the current copy operation first.");
    if (sources.length === 0) throw new Error("Select at least one system view to copy.");
    this.reset();
    this.copies = sources.map((source) => ({
      source: { ...source },
      personalViewId: globalThis.crypto.randomUUID(),
      definition: null,
      completed: false,
    }));
  }

  cancel(): void {
    if (!this.isCopying) this.reset();
  }

  reset(): void {
    this.request++;
    this.copies = [];
    this.selectedOwnerId = null;
    this.lockedOwnerId = null;
    this.isCopying = false;
    this.error = null;
  }

  selectOwner(ownerId: string | null, users: ActiveUser[]): void {
    if (this.lockedOwnerId !== null || this.isCopying) {
      throw new Error("Retry with the same owner, or close this operation.");
    }
    if (ownerId === null) {
      this.selectedOwnerId = null;
      return;
    }
    const selectedUser = users.find((user) => user.id.toLowerCase() === ownerId.toLowerCase());
    if (!selectedUser) {
      throw new Error("Select an available active user as the owner.");
    }
    this.selectedOwnerId = selectedUser.id;
  }

  async copyToPersonal(service: ViewDataService): Promise<boolean> {
    if (this.isCopying) return false;
    if (!this.isOpen) throw new Error("Select system views and open Copy to personal views first.");
    if (this.selectedOwnerId === null) throw new Error("Select an active user to own the personal views.");

    const request = this.request;
    const ownerId = this.lockedOwnerId ?? this.selectedOwnerId;
    this.lockedOwnerId = ownerId;
    this.isCopying = true;
    this.error = null;
    let current: PersonalViewCopy | null = null;
    try {
      for (const target of this.copies) {
        if (target.completed) continue;
        current = target;
        const exists = await service.personalViewExists(target.personalViewId);
        if (request !== this.request) return false;
        if (!exists) {
          const definition = target.definition ?? await service.getSystemViewDefinition(target.source.id);
          if (request !== this.request) return false;
          runInAction(() => { target.definition = definition; });
          await service.createPersonalView(target.personalViewId, definition, ownerId);
          if (request !== this.request) return false;
        }
        runInAction(() => { target.completed = true; });
      }
      this.reset();
      return true;
    } catch (error) {
      if (request !== this.request) return false;
      const detail = error instanceof Error ? error.message : "Dataverse could not complete the copy.";
      const completed = this.copies.filter((target) => target.completed).length;
      const progress = `${completed} of ${this.copies.length} views copied to personal views.`;
      const context = current
        ? `Could not copy "${current.source.name}".`
        : "";
      const message = /0x80048306|CreateAccess/i.test(detail)
        ? `${progress} ${context} Dataverse denied the copy because the account performing it lacks the Create privilege for personal views (User Query). Ask a Power Platform administrator to grant that privilege, then retry.`
        : `${progress} ${context} ${detail}`.trim();
      runInAction(() => { this.error = message; });
      throw new Error(message);
    } finally {
      runInAction(() => {
        if (request === this.request) this.isCopying = false;
      });
    }
  }
}
