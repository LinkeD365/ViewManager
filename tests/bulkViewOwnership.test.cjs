const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ViewModel,
  viewId,
  user,
  newUser,
  anotherUser,
  view,
  secondView,
  thirdView,
  deferred,
} = require("./helpers.cjs");

test("owner action requires one or more selected views; sharing loads only for one", async () => {
  const vm = new ViewModel();
  vm.personalViews = [view, secondView];
  let accessCalls = 0;
  const service = { getViewAccess: async () => { accessCalls++; return [user]; } };
  assert.equal(vm.canChangeViewOwners, false);
  await vm.selectViews(service, [view]);
  assert.equal(vm.selectedViews.length, 1);
  assert.equal(vm.selectedView.id, viewId);
  assert.equal(vm.canChangeViewOwners, true);
  await vm.selectViews(service, [view, secondView]);
  assert.equal(vm.selectedViews.length, 2);
  assert.equal(vm.selectedView, null);
  assert.equal(vm.viewAccess.length, 0);
  assert.equal(accessCalls, 1);
  assert.equal(vm.canChangeViewOwners, true);
  for (const flag of ["isLoadingUsers", "isLoadingPersonalViews", "isSavingViewAccess", "isChangingOwner"]) {
    vm[flag] = true;
    assert.equal(vm.canChangeViewOwners, false);
    vm[flag] = false;
  }
  vm.pendingAccess.set("User:test", 3);
  assert.equal(vm.canChangeViewOwners, false);
  await vm.selectViews(service, []);
  assert.equal(vm.selectedViews.length, 2);
  vm.pendingAccess.clear();
  await vm.selectViews(service, []);
  assert.equal(vm.canChangeViewOwners, false);
  assert.equal(vm.selectedView, null);
  await assert.rejects(vm.selectViews(service, [{ ...view, id: "stale" }]), /current view listing/);
});

test("multi-selection invalidates pending sharing reads and filter/refresh resets clear bulk selection", async () => {
  const vm = new ViewModel();
  vm.personalViews = [view, secondView];
  const wait = deferred();
  const loading = vm.selectViews({ getViewAccess: () => wait.promise }, [view]);
  await vm.selectViews({}, [view, secondView]);
  wait.resolve([user]);
  await loading;
  assert.equal(vm.selectedViews.length, 2);
  assert.equal(vm.selectedView, null);
  assert.equal(vm.viewAccess.length, 0);
  vm.setSelectedOwner(user.id);
  assert.equal(vm.selectedViews.length, 0);
  await vm.loadPersonalViews({ getPersonalViews: async () => [view, secondView] }, user.id);
  await vm.selectViews({}, [view, secondView]);
  await vm.loadPersonalViews({ getPersonalViews: async () => [view, secondView] }, user.id);
  assert.equal(vm.selectedViews.length, 0);
  await vm.selectViews({}, [view, secondView]);
  await vm.loadUsers({ getActiveUsers: async () => [] });
  assert.equal(vm.selectedViews.length, 0);
});

test("bulk assignment processes every selected view sequentially and refreshes once", async () => {
  const vm = new ViewModel();
  vm.personalViews = [view, secondView, thirdView];
  vm.activeUsers = [newUser];
  vm.selectedOwnerId = user.id;
  await vm.selectViews({}, [view, secondView]);
  vm.beginChangeViewOwner();
  assert.equal(vm.canChangeViewOwners, false);
  assert.deepEqual(vm.ownerChangeViews.map((entry) => entry.id), [viewId, secondView.id]);
  const calls = [];
  let refreshed = 0;
  let activeWrites = 0;
  assert.equal(await vm.changeViewOwner({
    changeViewOwner: async (id, ownerId) => {
      assert.equal(++activeWrites, 1);
      calls.push([id, ownerId]);
      await Promise.resolve();
      activeWrites--;
    },
    getPersonalViews: async (...args) => {
      refreshed++;
      assert.equal(vm.pendingOwnerChangeViews.length, 0);
      assert.deepEqual(args, [user.id, null]);
      return [thirdView];
    },
  }, newUser.id), true);
  assert.deepEqual(calls, [[viewId, newUser.id], [secondView.id, newUser.id]]);
  assert.equal(refreshed, 1);
  assert.deepEqual(vm.personalViews, [thirdView]);
  assert.equal(vm.selectedViews.length, 0);
  assert.equal(vm.ownerChangeViews.length, 0);
  assert.equal(vm.accessNavigationLocked, false);
});

test("bulk partial failure retains remaining views, locks the target owner and retries only unfinished writes", async () => {
  const vm = new ViewModel();
  vm.personalViews = [view, secondView, thirdView];
  vm.activeUsers = [newUser, anotherUser];
  vm.selectedOwnerId = user.id;
  await vm.selectViews({}, vm.personalViews);
  vm.beginChangeViewOwner();
  const calls = [];
  let fail = true;
  let refreshes = 0;
  const service = {
    changeViewOwner: async (id) => {
      calls.push(id);
      if (id === secondView.id && fail) throw new Error("Denied");
    },
    getPersonalViews: async () => { refreshes++; return []; },
  };
  await assert.rejects(vm.changeViewOwner(service, newUser.id), /Second view.*Denied.*1 of 3 views completed; 2 remain/);
  assert.deepEqual(calls, [viewId, secondView.id]);
  assert.equal(refreshes, 0);
  assert.deepEqual(vm.personalViews.map((entry) => entry.id), [secondView.id, thirdView.id]);
  assert.deepEqual(vm.pendingOwnerChangeViews.map((entry) => entry.id), [secondView.id, thirdView.id]);
  assert.equal(vm.ownerChangeOwnerId, newUser.id);
  assert.equal(vm.isChangingOwner, false);
  await assert.rejects(vm.changeViewOwner(service, anotherUser.id), /same owner/);
  fail = false;
  assert.equal(await vm.changeViewOwner(service, newUser.id), true);
  assert.deepEqual(calls, [viewId, secondView.id, secondView.id, thirdView.id]);
  assert.equal(refreshes, 1);
  assert.equal(vm.ownerChangeViews.length, 0);
});

test("bulk assignment supports mixed owners, skips views already owned by the chosen user and can close partial work", async () => {
  const vm = new ViewModel();
  const owned = { ...view, ownerId: newUser.id.toUpperCase(), ownerName: newUser.name };
  vm.personalViews = [owned, secondView, thirdView];
  vm.activeUsers = [newUser, anotherUser];
  vm.selectedTableLogicalName = "account";
  await vm.selectViews({}, vm.personalViews);
  vm.beginChangeViewOwner();
  assert.deepEqual(vm.availableViewOwners.map((entry) => entry.id), [newUser.id, anotherUser.id]);
  const calls = [];
  await assert.rejects(vm.changeViewOwner({
    changeViewOwner: async (id) => {
      calls.push(id);
      if (id === thirdView.id) throw new Error("Denied");
    },
  }, newUser.id), /2 of 3 views completed; 1 remain/);
  assert.deepEqual(calls, [secondView.id, thirdView.id]);
  assert.equal(vm.personalViews[1].ownerId, newUser.id);
  assert.equal(vm.pendingOwnerChangeViews[0].id, thirdView.id);
  vm.cancelChangeViewOwner();
  assert.equal(vm.ownerChangeViews.length, 0);
  assert.equal(vm.personalViews[1].ownerId, newUser.id);
  assert.equal(vm.personalViews[2].ownerId, user.id);
  assert.equal(vm.selectedViews.length, 0);
});

test("bulk read-role errors keep the friendly explanation and initial failures allow changing target", async () => {
  const vm = new ViewModel();
  vm.personalViews = [view, secondView];
  vm.activeUsers = [newUser, anotherUser];
  await vm.selectViews({}, vm.personalViews);
  vm.beginChangeViewOwner();
  await assert.rejects(vm.changeViewOwner({
    changeViewOwner: async () => { throw new Error("0x80042f09: prvReadUserQuery privilege required"); },
  }, newUser.id), /The user doesn't have the appropriate security group.*0 of 2 views completed; 2 remain/);
  assert.equal(vm.ownerChangeOwnerId, null);
  assert.equal(vm.selectedViews.length, 2);
  vm.cancelChangeViewOwner();
  assert.equal(vm.selectedViews.length, 2);
});

test("connection changes during a bulk assignment stop the remaining writes and suppress success", async () => {
  const vm = new ViewModel();
  vm.personalViews = [view, secondView, thirdView];
  vm.activeUsers = [newUser];
  vm.selectedOwnerId = user.id;
  await vm.selectViews({}, vm.personalViews);
  vm.beginChangeViewOwner();
  const wait = deferred();
  const calls = [];
  const changing = vm.changeViewOwner({
    changeViewOwner: async (id) => { calls.push(id); await wait.promise; },
    getPersonalViews: async () => assert.fail("Do not refresh a stale batch"),
  }, newUser.id);
  await vm.loadUsers({ getActiveUsers: async () => [] });
  wait.resolve();
  assert.equal(await changing, false);
  assert.deepEqual(calls, [viewId]);
  assert.equal(vm.ownerChangeViews.length, 0);
  assert.equal(vm.selectedViews.length, 0);
  assert.equal(vm.isChangingOwner, false);
});
