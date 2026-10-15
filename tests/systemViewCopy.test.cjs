const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ViewModel, createBulkAccessModel, createCopyModel, createCopyService, unmanagedSolution, viewDefinition,
  view, secondView, systemView, user,
} = require("./helpers.cjs");

test("view-copy workflows reject scopes above 100 before opening", () => {
  const personalViews = Array.from({ length: 101 }, (_, index) => ({ ...view, id: `personal-${index}` }));
  const personalModel = createBulkAccessModel(personalViews);
  assert.throws(() => personalModel.beginCopySystemViews(), /no more than 100 views/);
  assert.equal(personalModel.copySystemViews.isOpen, false);

  const systemViews = Array.from({ length: 101 }, (_, index) => ({ ...systemView, id: `system-${index}` }));
  const systemModel = new ViewModel();
  systemModel.activeTab = "system";
  systemModel.systemViews = systemViews;
  systemModel.selectedSystemViews = systemViews;
  assert.throws(() => systemModel.beginCopySystemViewToPersonal(), /no more than 100 views/);
  assert.equal(systemModel.copySystemViewToPersonal.isOpen, false);
});

test("copy is enabled for one or more selections and locks navigation while open", () => {
  for (const selected of [[view], [view, secondView]]) {
    const vm = createBulkAccessModel(selected);
    assert.equal(vm.canChangeViewOwners, true);
    vm.beginCopySystemViews();
    assert.equal(vm.copySystemViews.copies.length, selected.length);
    assert.equal(vm.accessNavigationLocked, true);
    assert.equal(vm.canChangeViewOwners, false);
    vm.setActiveTab("system");
    vm.setSelectedOwner(null);
    assert.equal(vm.activeTab, "personal");
    assert.equal(vm.selectedOwnerId, user.id);
    assert.throws(() => vm.beginChangeViewOwner(), /Finish|Wait/);
    assert.throws(() => vm.beginAddUsersToViews(), /finish or discard/);
    vm.copySystemViews.cancel();
    assert.equal(vm.accessNavigationLocked, false);
    assert.deepEqual(vm.selectedViews, selected);
  }
});

test("copy rejects empty, stale and blocked selections without opening a form", () => {
  const empty = createBulkAccessModel([]);
  assert.equal(empty.canChangeViewOwners, false);
  assert.throws(() => empty.beginCopySystemViews(), /Select one or more/);
  for (const blocked of ["pendingAccess", "isLoadingUsers", "isLoadingPersonalViews", "ownerChangeViews", "bulkAccessViews", "system"]) {
    const vm = createBulkAccessModel();
    if (blocked === "pendingAccess") vm.stageViewAccess(user, 3);
    else if (blocked === "system") vm.setActiveTab("system");
    else vm[blocked] = blocked.endsWith("Views") ? [view] : true;
    assert.throws(() => vm.beginCopySystemViews(), /finish or discard/);
    assert.equal(vm.copySystemViews.isOpen, false);
  }
  const stale = createBulkAccessModel([view]);
  stale.selectedViews = [secondView];
  assert.throws(() => stale.beginCopySystemViews(), /current view listing/);
});

test("solution load failures and empty lists are explicit and can be retried", async () => {
  const copy = createCopyModel().copySystemViews;
  const service = createCopyService({
    getUnmanagedSolutions: async () => { throw new Error("Cannot read solutions"); },
  });
  await assert.rejects(copy.loadSolutions(service), /Cannot read solutions/);
  assert.equal(copy.solutionsError, "Cannot read solutions");
  assert.equal(copy.isLoadingSolutions, false);
  await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /available unmanaged solution/);
  service.getUnmanagedSolutions = async () => [];
  await copy.loadSolutions(service);
  assert.equal(copy.solutionsError, null);
  assert.deepEqual(copy.solutions, []);
  await assert.rejects(copy.copy(service, "missing"), /available unmanaged solution/);
  service.getUnmanagedSolutions = async () => [unmanagedSolution];
  await copy.loadSolutions(service);
  assert.deepEqual(copy.solutions, [unmanagedSolution]);
});

test("multiple personal views copy sequentially to one solution without changing the originals", async () => {
  const vm = createCopyModel();
  const copy = vm.copySystemViews;
  const calls = [];
  const service = createCopyService({
    systemViewExists: async (id) => { calls.push(["exists", id]); return false; },
    getPersonalViewDefinition: async (id) => { calls.push(["retrieve", id]); return viewDefinition; },
    createSystemView: async (id, definition) => { calls.push(["create", id]); assert.deepEqual(definition, viewDefinition); },
    addSystemViewToSolution: async (id, uniqueName) => { calls.push(["add", id]); assert.equal(uniqueName, unmanagedSolution.uniqueName); },
  });
  const ids = copy.copies.map((item) => item.systemViewId);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every((id) => id !== view.id && id !== secondView.id));
  await copy.loadSolutions(service);
  assert.equal(await copy.copy(service, unmanagedSolution.uniqueName), true);
  assert.deepEqual(calls, [
    ["exists", ids[0]], ["retrieve", view.id], ["create", ids[0]], ["add", ids[0]],
    ["exists", ids[1]], ["retrieve", secondView.id], ["create", ids[1]], ["add", ids[1]],
  ]);
  assert.equal(copy.isOpen, false);
  assert.equal(copy.isCopying, false);
  assert.equal(vm.accessNavigationLocked, false);
  assert.deepEqual(vm.personalViews, [view, secondView]);
  assert.deepEqual(vm.selectedViews, [view, secondView]);
  assert.equal(vm.selectedView.id, view.id);
});

test("a failed solution addition retains the created ID and retries without recreating it", async () => {
  const copy = createCopyModel().copySystemViews;
  const created = [];
  const added = [];
  let fail = true;
  const service = createCopyService({
    createSystemView: async (id) => { created.push(id); },
    addSystemViewToSolution: async (id) => {
      added.push(id);
      if (fail) throw new Error("Add denied");
    },
  });
  await copy.loadSolutions(service);
  const firstId = copy.copies[0].systemViewId;
  await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /was created.*could not be added.*Add denied/);
  assert.equal(copy.copies[0].created, true);
  assert.equal(copy.copies[0].added, false);
  assert.match(copy.error, /0 of 2/);
  assert.equal(copy.lockedSolution, unmanagedSolution.uniqueName);
  assert.equal(copy.isCopying, false);
  fail = false;
  assert.equal(await copy.copy(service, unmanagedSolution.uniqueName), true);
  assert.equal(created.length, 2);
  assert.equal(created.filter((id) => id === firstId).length, 1);
  assert.deepEqual(added.slice(0, 2), [firstId, firstId]);
});

test("partial creation failures preserve completed copies and retry only remaining work", async () => {
  const copy = createCopyModel().copySystemViews;
  const ids = copy.copies.map((item) => item.systemViewId);
  const created = [];
  const added = [];
  const retrieved = [];
  let fail = true;
  const service = createCopyService({
    getPersonalViewDefinition: async (id) => { retrieved.push(id); return viewDefinition; },
    createSystemView: async (id) => {
      created.push(id);
      if (id === ids[1] && fail) throw new Error("Create denied");
    },
    addSystemViewToSolution: async (id) => { added.push(id); },
  });
  await copy.loadSolutions(service);
  await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /1 of 2.*Second view.*Create denied/);
  assert.equal(copy.copies[0].added, true);
  copy.solutions.push({ ...unmanagedSolution, id: user.id, uniqueName: "OtherSolution" });
  await assert.rejects(copy.copy(service, "OtherSolution"), /same solution/);
  fail = false;
  assert.equal(await copy.copy(service, unmanagedSolution.uniqueName), true);
  assert.deepEqual(created, [ids[0], ids[1], ids[1]]);
  assert.deepEqual(added, ids);
  assert.deepEqual(retrieved, [view.id, secondView.id]);
});

test("lost create responses recover the existing copy instead of creating a duplicate", async () => {
  const copy = createCopyModel([view]).copySystemViews;
  const storedIds = new Set();
  const added = [];
  let createCalls = 0;
  const service = createCopyService({
    systemViewExists: async (id) => storedIds.has(id),
    createSystemView: async (id) => {
      createCalls++;
      storedIds.add(id);
      throw new Error("Response connection lost");
    },
    addSystemViewToSolution: async (id) => { added.push(id); },
  });
  await copy.loadSolutions(service);
  const id = copy.copies[0].systemViewId;
  await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /Response connection lost/);
  assert.equal(copy.copies[0].created, false);
  assert.equal(await copy.copy(service, unmanagedSolution.uniqueName), true);
  assert.equal(createCalls, 1);
  assert.deepEqual(added, [id]);
});

test("copy revalidates that the selected solution is still available before any writes", async () => {
  for (const solutions of [[], [{ ...unmanagedSolution, id: user.id }]]) {
    const copy = createCopyModel().copySystemViews;
    const service = createCopyService({ systemViewExists: async () => assert.fail("Do not start copying") });
    await copy.loadSolutions(service);
    service.getUnmanagedSolutions = async () => solutions;
    await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /no longer available/);
    assert.equal(copy.lockedSolution, null);
    assert.ok(copy.copies.every((item) => !item.created));
  }
});

test("closing a partial batch unlocks navigation without undoing server changes", async () => {
  const vm = createCopyModel([view]);
  const copy = vm.copySystemViews;
  let creates = 0;
  const service = createCopyService({
    createSystemView: async () => { creates++; },
    addSystemViewToSolution: async () => { throw new Error("Solution unavailable"); },
  });
  await copy.loadSolutions(service);
  await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName));
  assert.equal(copy.copies[0].created, true);
  copy.cancel();
  assert.equal(copy.isOpen, false);
  assert.equal(vm.accessNavigationLocked, false);
  assert.equal(creates, 1);
  await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /open Copy/);
});
