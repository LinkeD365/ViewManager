import { makeAutoObservable, runInAction } from "mobx";
import type {
  CrossEnvironmentCopyKind, CrossEnvironmentDestination, EnvironmentTargetOption,
  PersonalEnvironmentCopy, PersonalView, SystemEnvironmentCopy, SystemView, ViewDataService,
} from "./viewModel";
import { MAX_BULK_VIEW_COUNT, MAX_CROSS_ENVIRONMENT_COPIES } from "./operationLimits";

export class CrossEnvironmentCopyModel {
  kind: CrossEnvironmentCopyKind | null = null;
  targets: EnvironmentTargetOption[] = [];
  selectedTargetSlots: number[] = [];
  destinations: CrossEnvironmentDestination[] = [];
  personalSources: PersonalView[] = [];
  systemSources: SystemView[] = [];
  personalCopies: PersonalEnvironmentCopy[] = [];
  systemCopies: SystemEnvironmentCopy[] = [];
  isLoadingOptions = false;
  optionsError: string | null = null;
  isCopying = false;
  error: string | null = null;
  private request = 0;

  constructor() {
    makeAutoObservable(this);
  }

  get isOpen(): boolean {
    return this.kind !== null;
  }

  beginPersonal(views: PersonalView[], targets: EnvironmentTargetOption[]): void {
    if (views.length === 0) throw new Error("Select at least one personal view to copy.");
    if (views.length > MAX_BULK_VIEW_COUNT) {
      throw new Error(`Copy no more than ${MAX_BULK_VIEW_COUNT} views per operation.`);
    }
    this.begin("personal", targets);
    this.personalSources = views.map((view) => ({ ...view }));
  }

  beginSystem(views: SystemView[], targets: EnvironmentTargetOption[]): void {
    if (views.length === 0) throw new Error("Select at least one system view to copy.");
    if (views.length > MAX_BULK_VIEW_COUNT) {
      throw new Error(`Copy no more than ${MAX_BULK_VIEW_COUNT} views per operation.`);
    }
    this.begin("system", targets);
    this.systemSources = views.map((view) => ({ ...view }));
  }

  private begin(kind: CrossEnvironmentCopyKind, targets: EnvironmentTargetOption[]): void {
    if (this.isOpen || this.isCopying) throw new Error("Finish the current cross-environment copy first.");
    if (targets.length === 0) throw new Error("Configure at least one destination environment.");
    if (targets.length > 6) throw new Error("Copying supports up to seven environments, including the primary source.");
    this.reset();
    this.kind = kind;
    this.targets = targets.map((target) => ({ ...target }));
  }

  async selectTargets(
    slots: number[],
    services: Map<number, ViewDataService>,
  ): Promise<void> {
    if (!this.kind || this.isCopying) return;
    const uniqueSlots = [...new Set(slots)];
    if (uniqueSlots.some((slot) => !this.targets.some((target) => target.slot === slot))) {
      throw new Error("Select configured destination environments.");
    }
    const copiesPerDestination = this.kind === "personal" ? this.personalSources.length : this.systemSources.length;
    if (uniqueSlots.length * copiesPerDestination > MAX_CROSS_ENVIRONMENT_COPIES) {
      throw new Error(`This operation exceeds the ${MAX_CROSS_ENVIRONMENT_COPIES}-copy limit. Select fewer destinations or views.`);
    }
    if (this.destinations.some((destination) =>
      destination.lockedOwnerId !== null || destination.lockedSolution !== null)) {
      throw new Error("Destination environments cannot change after a copy has started.");
    }
    const request = ++this.request;
    this.selectedTargetSlots = uniqueSlots;
    this.destinations = uniqueSlots.map((slot) => {
      const previous = this.destinations.find((item) => item.slot === slot);
      const target = this.targets.find((item) => item.slot === slot);
      if (!target) throw new Error(`Destination slot ${slot + 1} is not configured.`);
      return previous ?? {
        ...target,
        users: [],
        solutions: [],
        isLoading: false,
        error: null,
        selectedOwnerId: null,
        lockedOwnerId: null,
        selectedSolution: null,
        lockedSolution: null,
      };
    });
    this.createCopies();
    this.isLoadingOptions = uniqueSlots.length > 0;
    this.optionsError = null;
    try {
      await Promise.all(uniqueSlots.map(async (slot) => {
        const destination = this.destinations.find((item) => item.slot === slot);
        const service = services.get(slot);
        if (!destination || !service) throw new Error(`No Dataverse connection is configured for slot ${slot + 1}.`);
        if (this.kind === "personal" && destination.users.length > 0) return;
        if (this.kind === "system" && destination.solutions.length > 0) return;
        runInAction(() => { destination.isLoading = true; destination.error = null; });
        try {
          if (this.kind === "personal") {
            const users = await service.getActiveUsers();
            if (request !== this.request) return;
            runInAction(() => { destination.users = users; });
          } else {
            const solutions = await service.getUnmanagedSolutions();
            if (request !== this.request) return;
            runInAction(() => { destination.solutions = solutions; });
          }
        } catch (error) {
          if (request !== this.request) return;
          const message = error instanceof Error ? error.message : "Unable to load destination options.";
          runInAction(() => {
            destination.error = message;
            this.optionsError = `${destination.name}: ${message}`;
          });
        } finally {
          runInAction(() => { destination.isLoading = false; });
        }
      }));
    } finally {
      runInAction(() => {
        if (request === this.request) this.isLoadingOptions = false;
      });
    }
  }

  selectOwner(slot: number, ownerId: string | null): void {
    const destination = this.getDestination(slot, "personal");
    if (destination.lockedOwnerId !== null || this.isCopying) {
      throw new Error("Retry with the same destination owner, or close this operation.");
    }
    if (ownerId === null) {
      destination.selectedOwnerId = null;
      return;
    }
    const user = destination.users.find((item) => item.id.toLowerCase() === ownerId.toLowerCase());
    if (!user) throw new Error("Select an active user in the destination environment.");
    destination.selectedOwnerId = user.id;
  }

  selectSolution(slot: number, uniqueName: string | null): void {
    const destination = this.getDestination(slot, "system");
    if (destination.lockedSolution !== null || this.isCopying) {
      throw new Error("Retry with the same destination solution, or close this operation.");
    }
    if (uniqueName === null) {
      destination.selectedSolution = null;
      return;
    }
    if (!destination.solutions.some((item) => item.uniqueName === uniqueName)) {
      throw new Error("Select an unmanaged solution in the destination environment.");
    }
    destination.selectedSolution = uniqueName;
  }

  private getDestination(slot: number, kind: CrossEnvironmentCopyKind): CrossEnvironmentDestination {
    if (this.kind !== kind) throw new Error(`The current operation does not copy ${kind} views.`);
    const destination = this.destinations.find((item) => item.slot === slot);
    if (!destination) throw new Error("Select a configured destination environment.");
    return destination;
  }

  private createCopies(): void {
    this.personalCopies = this.destinations.flatMap((destination) => this.personalSources.map((source) => {
      const existing = this.personalCopies.find((copy) =>
        copy.destinationSlot === destination.slot && copy.source.id === source.id);
      return existing ?? {
        source,
        destinationSlot: destination.slot,
        targetViewId: globalThis.crypto.randomUUID(),
        definition: null,
        completed: false,
      };
    }));
    this.systemCopies = this.destinations.flatMap((destination) => this.systemSources.map((source) => {
      const existing = this.systemCopies.find((copy) =>
        copy.destinationSlot === destination.slot && copy.source.id === source.id);
      return existing ?? {
        source,
        destinationSlot: destination.slot,
        targetViewId: globalThis.crypto.randomUUID(),
        definition: null,
        created: false,
        added: false,
      };
    }));
  }

  async loadOptions(services: Map<number, ViewDataService>): Promise<void> {
    await this.selectTargets(this.selectedTargetSlots, services);
  }

  cancel(): void {
    if (!this.isCopying) this.reset();
  }

  reset(): void {
    this.request++;
    this.kind = null;
    this.targets = [];
    this.selectedTargetSlots = [];
    this.destinations = [];
    this.personalSources = [];
    this.systemSources = [];
    this.personalCopies = [];
    this.systemCopies = [];
    this.isLoadingOptions = false;
    this.optionsError = null;
    this.isCopying = false;
    this.error = null;
  }

  async copy(source: ViewDataService, targetServices: Map<number, ViewDataService>): Promise<boolean> {
    if (this.isCopying) return false;
    if (this.kind === null || this.selectedTargetSlots.length === 0) {
      throw new Error("Select at least one destination environment.");
    }
    if (this.isLoadingOptions || this.optionsError) throw new Error("Load destination options before copying.");
    if (this.kind === "personal" && this.destinations.some((dest) => !dest.selectedOwnerId)) {
      throw new Error("Select an owner in each destination environment.");
    }
    if (this.kind === "system" && this.destinations.some((dest) => !dest.selectedSolution)) {
      throw new Error("Select an unmanaged solution in each destination environment.");
    }
    const request = this.request;
    const kind = this.kind;
    this.destinations.forEach((destination) => {
      if (kind === "personal") destination.lockedOwnerId = destination.selectedOwnerId;
      else destination.lockedSolution = destination.selectedSolution;
    });
    this.isCopying = true;
    this.error = null;
    let currentName = "";
    let currentDestination = "";
    try {
      if (kind === "personal") {
        for (const copy of this.personalCopies) {
          if (copy.completed) continue;
          currentName = copy.source.name;
          const destination = this.getDestination(copy.destinationSlot, kind);
          currentDestination = destination.name;
          const target = this.getService(targetServices, copy.destinationSlot);
          const exists = await target.personalViewExists(copy.targetViewId);
          this.assertRequest(request);
          if (!exists) {
            const definition = copy.definition ?? await source.getPersonalViewDefinition(copy.source.id);
            this.assertRequest(request);
            runInAction(() => { copy.definition = definition; });
            const ownerId = destination.lockedOwnerId;
            if (!ownerId) throw new Error(`Select an owner for ${destination.name}.`);
            await target.createPersonalView(copy.targetViewId, definition, ownerId);
            this.assertRequest(request);
          }
          runInAction(() => { copy.completed = true; });
        }
      } else {
        for (const copy of this.systemCopies) {
          if (copy.added) continue;
          currentName = copy.source.name;
          const destination = this.getDestination(copy.destinationSlot, kind);
          currentDestination = destination.name;
          const target = this.getService(targetServices, copy.destinationSlot);
          if (!copy.created) {
            const exists = await target.systemViewExists(copy.targetViewId);
            this.assertRequest(request);
            if (!exists) {
              const definition = copy.definition ?? await source.getSystemViewDefinition(copy.source.id);
              this.assertRequest(request);
              runInAction(() => { copy.definition = definition; });
              await target.createSystemView(copy.targetViewId, definition);
              this.assertRequest(request);
            }
            runInAction(() => { copy.created = true; });
          }
          const solution = destination.lockedSolution;
          if (!solution) throw new Error(`Select an unmanaged solution for ${destination.name}.`);
          await target.addSystemViewToSolution(copy.targetViewId, solution);
          this.assertRequest(request);
          runInAction(() => { copy.added = true; });
        }
      }
      this.reset();
      return true;
    } catch (error) {
      if (request !== this.request) return false;
      const copies = kind === "personal" ? this.personalCopies : this.systemCopies;
      const completed = copies.filter((copy) => kind === "personal"
        ? "completed" in copy && copy.completed
        : "added" in copy && copy.added).length;
      const detail = error instanceof Error ? error.message : "Dataverse could not complete the copy.";
      const progress = `${completed} of ${copies.length} view ${copies.length === 1 ? "copy" : "copies"} completed.`;
      const context = currentDestination
        ? `Could not copy "${currentName}" to ${currentDestination}.`
        : "Could not complete the copy.";
      const missingTable = detail.match(
        /0x80041102[\s\S]*?entity\s+with\s+a\s+name\s*=\s*['"]([^'"]+)['"][\s\S]*?was not found in the MetadataCache/i,
      );
      const friendlyDetail = missingTable
        ? `The destination environment could not find the "${missingTable[1]}" table required by this view. Make sure the table is installed and published in the destination environment, then retry.`
        : detail;
      const message = `${progress} ${context} ${friendlyDetail}`;
      runInAction(() => { this.error = message; });
      throw new Error(message);
    } finally {
      runInAction(() => {
        if (request === this.request) this.isCopying = false;
      });
    }
  }

  private getService(services: Map<number, ViewDataService>, slot: number): ViewDataService {
    const service = services.get(slot);
    if (!service) throw new Error(`The destination connection in slot ${slot + 1} is no longer available.`);
    return service;
  }

  private assertRequest(request: number): void {
    if (request !== this.request) throw new Error("The copy operation was closed or changed.");
  }
}
