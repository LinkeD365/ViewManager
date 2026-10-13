const assert = require("node:assert/strict");
const test = require("node:test");
const {
  viewId,
  user,
  newUser,
  view,
  createService,
  createModel,
  deferred,
} = require("./helpers.cjs");

test("change owner sends Assign with typed view and user and logs invalid requests/failures", async () => {
  const calls = [];
  const { service, logs } = createService(async (request) => { calls.push(request); return {}; });
  await service.changeViewOwner(viewId, newUser.id);
  assert.deepEqual(calls, [{
    operationName: "Assign",
    operationType: "action",
    parameters: {
      Target: { "@odata.type": "Microsoft.Dynamics.CRM.userquery", userqueryid: viewId },
      Assignee: { "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: newUser.id },
    },
  }]);
  await assert.rejects(service.changeViewOwner("invalid", newUser.id), /ID is invalid/);
  await assert.rejects(service.changeViewOwner(viewId, "invalid"), /ID is invalid/);
  assert.equal(calls.length, 1);
  assert.equal(logs.length, 2);
  assert.ok(logs.every(([, level]) => level === "error"));
  const denied = createService(async () => { throw new Error("Assign privilege required"); });
  await assert.rejects(denied.service.changeViewOwner(viewId, newUser.id), /Assign privilege required/);
  assert.match(denied.logs[0][0], /Assign.*Assign privilege required/);
});

test("missing user-view read role shows a friendly assignment error and retains technical logs", async () => {
  const detail = "Error invoking remote method 'dataverse:execute': Error: Dataverse execute failed: "
    + `0x80042f09: ThrowCrmSecurityException: The user with id ${newUser.id} has not been assigned any roles. `
    + "They need a role with the prvReadUserQuery privilege.";
  const friendly = "The user doesn't have the appropriate security group to allow read to user views";
  for (const error of [new Error(detail), detail]) {
    const vm = createModel();
    vm.activeUsers = [newUser];
    vm.beginChangeViewOwner([view]);
    const { service, logs } = createService(async () => { throw error; });
    await assert.rejects(vm.changeViewOwner(service, newUser.id), { message: friendly });
    assert.equal(vm.ownerChangeError, friendly);
    assert.equal(vm.ownerChangeViews[0].id, viewId);
    assert.equal(vm.personalViews[0].ownerId, user.id);
    assert.equal(vm.isChangingOwner, false);
    assert.ok(logs.some(([message, level]) => level === "error" && message.includes(detail)));
  }
});

test("other assignment privileges and post-assignment read failures retain their original messages", async () => {
  for (const detail of [
    "0x80042f09: The user has not been assigned any roles. They need the prvReadAccount privilege.",
    "The user is missing the prvAssignUserQuery privilege.",
    "Network request failed",
  ]) {
    const vm = createModel();
    vm.activeUsers = [newUser];
    vm.beginChangeViewOwner([view]);
    await assert.rejects(vm.changeViewOwner({
      changeViewOwner: async () => { throw new Error(detail); },
    }, newUser.id), { message: `Unable to change the view's owner: ${detail}` });
    assert.equal(vm.ownerChangeError, `Unable to change the view's owner: ${detail}`);
  }
  const vm = createModel();
  vm.activeUsers = [newUser];
  vm.selectedOwnerId = user.id;
  vm.beginChangeViewOwner([view]);
  await assert.rejects(vm.changeViewOwner({
    changeViewOwner: async () => {},
    getPersonalViews: async () => { throw new Error("0x80042f09: prvReadUserQuery privilege required"); },
  }, newUser.id), /owner was changed, but reloading views failed/);
  assert.equal(vm.ownerChangeViews.length, 0);
});

test("owner dialog excludes current owner, blocks navigation, and cancel preserves selection", async () => {
  const vm = createModel();
  vm.activeUsers = [{ id: user.id.toUpperCase(), name: user.name, isCurrentUser: true }, newUser];
  vm.beginChangeViewOwner([view]);
  assert.deepEqual(vm.availableViewOwners.map((owner) => owner.id), [newUser.id]);
  assert.equal(vm.accessNavigationLocked, true);
  vm.setSelectedOwner(newUser.id);
  await vm.selectView({}, null);
  await vm.loadPersonalViews({}, null);
  assert.equal(vm.selectedOwnerId, null);
  assert.equal(vm.selectedView.id, viewId);
  await assert.rejects(vm.changeViewOwner({}, user.id), /different available user/);
  await assert.rejects(vm.changeViewOwner({}, "unknown"), /different available user/);
  vm.cancelChangeViewOwner();
  assert.equal(vm.ownerChangeViews.length, 0);
  assert.equal(vm.selectedView.id, viewId);
  assert.equal(vm.accessNavigationLocked, false);
  vm.stageViewAccess(user, 3);
  assert.throws(() => vm.beginChangeViewOwner([view]), /discard access changes/);
  vm.discardAccessChanges();
  vm.isLoadingPersonalViews = true;
  assert.throws(() => vm.beginChangeViewOwner([view]), /Finish the current operation/);
  vm.isLoadingPersonalViews = false;
  assert.throws(() => vm.beginChangeViewOwner([{ ...view, id: "stale" }]), /current view listing/);
});

test("owner change refreshes the current filter and clears stale sharing selection", async () => {
  for (const filterOwnerId of [user.id, null]) {
    const vm = createModel();
    vm.activeUsers = [newUser];
    vm.selectedOwnerId = filterOwnerId;
    vm.selectedTableLogicalName = filterOwnerId === null ? "account" : null;
    vm.beginChangeViewOwner([view]);
    const updatedView = { ...view, ownerId: newUser.id, ownerName: newUser.name };
    const expected = filterOwnerId === null ? [updatedView] : [];
    let assigned = false;
    const saved = await vm.changeViewOwner({
      changeViewOwner: async (...args) => {
        assert.deepEqual(args, [viewId, newUser.id]);
        assigned = true;
      },
      getPersonalViews: async (...args) => {
        assert.equal(assigned, true);
        assert.deepEqual(args, [filterOwnerId, filterOwnerId === null ? "account" : null]);
        assert.deepEqual(vm.personalViews.map((entry) => entry.ownerId), expected.map((entry) => entry.ownerId));
        return expected;
      },
    }, newUser.id);
    assert.equal(saved, true);
    assert.deepEqual(vm.personalViews, expected);
    assert.equal(vm.selectedView, null);
    assert.equal(vm.viewAccess.length, 0);
    assert.equal(vm.ownerChangeViews.length, 0);
    assert.equal(vm.isChangingOwner, false);
    assert.equal(vm.accessNavigationLocked, false);
  }
});

test("failed owner assignment keeps the dialog for retry without changing local ownership", async () => {
  const vm = createModel();
  vm.activeUsers = [newUser];
  vm.selectedOwnerId = user.id;
  vm.beginChangeViewOwner([view]);
  await assert.rejects(vm.changeViewOwner({
    changeViewOwner: async () => { throw new Error("Denied"); },
    getPersonalViews: async () => assert.fail("Failed assignment should not refresh"),
  }, newUser.id), /Unable to change.*Denied/);
  assert.match(vm.ownerChangeError, /Denied/);
  assert.equal(vm.ownerChangeViews[0].id, viewId);
  assert.equal(vm.personalViews[0].ownerId, user.id);
  assert.equal(vm.selectedView.id, viewId);
  assert.equal(vm.isChangingOwner, false);
  assert.equal(await vm.changeViewOwner({
    changeViewOwner: async () => {},
    getPersonalViews: async () => [],
  }, newUser.id), true);
  assert.equal(vm.ownerChangeError, null);
});

test("owner assignment reload failure reports saved ownership and does not invite duplicate assignment", async () => {
  const vm = createModel();
  vm.activeUsers = [newUser];
  vm.selectedOwnerId = user.id;
  vm.beginChangeViewOwner([view]);
  await assert.rejects(vm.changeViewOwner({
    changeViewOwner: async () => {},
    getPersonalViews: async () => { throw new Error("Read denied"); },
  }, newUser.id), /owner was changed, but reloading views failed.*Read denied/);
  assert.equal(vm.ownerChangeViews.length, 0);
  assert.equal(vm.personalViews.length, 0);
  assert.equal(vm.isChangingOwner, false);
  assert.equal(vm.accessNavigationLocked, false);
  assert.match(vm.personalViewsError, /owner was changed/);
});

test("in-flight owner assignment blocks duplicate writes and cannot be cancelled", async () => {
  const vm = createModel();
  vm.activeUsers = [newUser];
  vm.selectedOwnerId = user.id;
  vm.beginChangeViewOwner([view]);
  const wait = deferred();
  const changing = vm.changeViewOwner({
    changeViewOwner: () => wait.promise,
    getPersonalViews: async () => [],
  }, newUser.id);
  assert.equal(vm.isChangingOwner, true);
  assert.equal(await vm.changeViewOwner({}, newUser.id), false);
  vm.cancelChangeViewOwner();
  assert.equal(vm.ownerChangeViews[0].id, viewId);
  wait.resolve();
  assert.equal(await changing, true);
});

test("connection resets and unmounts invalidate owner assignment and reload responses", async () => {
  for (const reset of ["connection", "unmount"]) {
    for (const phase of ["assign", "reload"]) {
      const vm = createModel();
      vm.activeUsers = [newUser];
      vm.selectedOwnerId = user.id;
      vm.beginChangeViewOwner([view]);
      const wait = deferred();
      const reloadStarted = deferred();
      const changing = vm.changeViewOwner({
        changeViewOwner: async () => { if (phase === "assign") await wait.promise; },
        getPersonalViews: async () => {
          if (phase === "assign") assert.fail("Stale assignment must not reload");
          reloadStarted.resolve();
          return wait.promise;
        },
      }, newUser.id);
      if (phase === "reload") await reloadStarted.promise;
      if (reset === "connection") await vm.loadUsers({ getActiveUsers: async () => [] });
      else vm.resetOwnerChange();
      vm.personalViews = [];
      wait.resolve([view]);
      assert.equal(await changing, false);
      assert.equal(vm.personalViews.length, 0);
      assert.equal(vm.ownerChangeViews.length, 0);
      assert.equal(vm.isChangingOwner, false);
    }
  }
});
