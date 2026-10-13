import { makeAutoObservable, runInAction } from "mobx";
import type { PersonalView, SystemViewCopy, UnmanagedSolution, ViewDataService } from "./viewModel";

export class CopySystemViewsModel {
  copies: SystemViewCopy[] = [];
  solutions: UnmanagedSolution[] = [];
  isLoadingSolutions = false;
  solutionsError: string | null = null;
  isCopying = false;
  lockedSolution: string | null = null;
  error: string | null = null;
  private request = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get isOpen(): boolean {
    return this.copies.length > 0;
  }

  begin(views: PersonalView[]): void {
    if (this.isOpen || this.isCopying) throw new Error("Finish the current copy operation first.");
    if (views.length === 0) throw new Error("Select at least one personal view to copy.");
    this.reset();
    this.copies = views.map((source) => ({
      source: { ...source },
      systemViewId: globalThis.crypto.randomUUID(),
      definition: null,
      created: false,
      added: false,
    }));
  }

  cancel(): void {
    if (!this.isCopying) this.reset();
  }

  reset(): void {
    this.request++;
    this.copies = [];
    this.solutions = [];
    this.isLoadingSolutions = false;
    this.solutionsError = null;
    this.isCopying = false;
    this.lockedSolution = null;
    this.error = null;
  }

  async loadSolutions(service: ViewDataService): Promise<void> {
    if (!this.isOpen || this.isLoadingSolutions || this.isCopying) return;
    const request = this.request;
    this.isLoadingSolutions = true;
    this.solutionsError = null;
    try {
      const solutions = await service.getUnmanagedSolutions();
      runInAction(() => {
        if (request === this.request) this.solutions = solutions;
      });
    } catch (error) {
      if (request !== this.request) return;
      runInAction(() => {
        this.solutionsError = error instanceof Error ? error.message : "Unable to load unmanaged solutions.";
      });
      throw error;
    } finally {
      runInAction(() => {
        if (request === this.request) this.isLoadingSolutions = false;
      });
    }
  }

  async copy(service: ViewDataService, uniqueName: string): Promise<boolean> {
    if (this.isCopying) return false;
    if (!this.isOpen) throw new Error("Select views and open Copy to system views first.");
    const solution = this.solutions.find((item) => item.uniqueName === uniqueName);
    if (!solution || this.isLoadingSolutions || this.solutionsError) {
      throw new Error("Select an available unmanaged solution.");
    }
    if (this.lockedSolution !== null && this.lockedSolution !== uniqueName) {
      throw new Error("Retry with the same solution, or close this operation.");
    }
    const request = this.request;
    this.isCopying = true;
    this.error = null;
    let current: SystemViewCopy | null = null;
    try {
      const available = await service.getUnmanagedSolutions();
      if (request !== this.request) return false;
      if (!available.some((item) => item.id === solution.id && item.uniqueName === uniqueName)) {
        throw new Error("The selected unmanaged solution is no longer available. Close the form and select another solution.");
      }
      runInAction(() => { this.lockedSolution = uniqueName; });
      for (const target of this.copies) {
        if (target.added) continue;
        current = target;
        if (!target.created) {
          // A stable ID and existence check recover a create whose response was lost.
          const exists = await service.systemViewExists(target.systemViewId);
          if (request !== this.request) return false;
          if (!exists) {
            const definition = target.definition ?? await service.getPersonalViewDefinition(target.source.id);
            if (request !== this.request) return false;
            runInAction(() => { target.definition = definition; });
            await service.createSystemView(target.systemViewId, definition);
            if (request !== this.request) return false;
          }
          runInAction(() => { target.created = true; });
        }
        await service.addSystemViewToSolution(target.systemViewId, uniqueName);
        if (request !== this.request) return false;
        runInAction(() => { target.added = true; });
      }
      this.reset();
      return true;
    } catch (error) {
      if (request !== this.request) return false;
      const detail = error instanceof Error ? error.message : "Dataverse could not complete the copy.";
      const progress = `${this.copies.filter((target) => target.added).length} of ${this.copies.length} views added to the solution.`;
      const context = current?.created
        ? `"${current.source.name}" was created (${current.systemViewId}) but could not be added to the solution.`
        : current ? `Could not complete the copy of "${current.source.name}" (${current.systemViewId}).` : "";
      const message = `${progress} ${context} ${detail}`.trim();
      runInAction(() => { this.error = message; });
      throw new Error(message);
    } finally {
      runInAction(() => {
        if (request === this.request) this.isCopying = false;
      });
    }
  }
}
