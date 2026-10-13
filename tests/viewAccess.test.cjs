const assert = require("node:assert/strict");
const test = require("node:test");
const {
  viewId,
  user,
  team,
  view,
  createModel,
  deferred,
} = require("./helpers.cjs");

test("staging is local, zero is retained, restoring original values and discard clear dirty state", () => {
  const vm = createModel();
  vm.stageViewAccess(user, 3);
  assert.equal(vm.viewAccess[0].accessRightsMask, 1);
  assert.equal(vm.displayedViewAccess[0].accessRightsMask, 3);
  assert.equal(vm.hasAccessChanges, true);
  vm.stageViewAccess(user, 1);
  assert.equal(vm.hasAccessChanges, false);
  vm.stageViewAccess(team, 0);
  assert.deepEqual(vm.displayedViewAccess.map((entry) => entry.id), [user.id]);
  vm.discardAccessChanges();
  assert.equal(vm.displayedViewAccess[1].accessRightsMask, 1);
  assert.equal(vm.accessNavigationLocked, false);
  vm.viewAccess = [{ ...user, accessRightsMask: 8 }];
  assert.throws(() => vm.stageViewAccess(user, 1), /unsupported rights/);
});

test("save writes only changed principals and reloads confirmed results", async () => {
  const vm = createModel();
  const calls = [];
  vm.stageViewAccess(user, 3);
  vm.stageViewAccess(team, 0);
  const service = {
    updateViewAccess: async (...args) => { calls.push(args); },
    getViewAccess: async (id) => {
      assert.equal(id, viewId);
      assert.equal(calls.length, 2);
      return [{ ...user, accessRightsMask: 3 }];
    },
  };
  assert.equal(await vm.saveViewAccess(service), true);
  assert.deepEqual(calls.map(([id, principal, mask]) => [id, principal.id, mask]), [[viewId, user.id, 3], [viewId, team.id, 0]]);
  assert.equal(vm.viewAccess.length, 1);
  assert.equal(vm.viewAccess[0].accessRightsMask, 3);
  assert.equal(vm.hasAccessChanges, false);
  assert.equal(vm.isSavingViewAccess, false);
  assert.equal(await vm.saveViewAccess(service), false);
  assert.equal(calls.length, 2);
});

test("partial failures preserve unsaved edits and retries do not repeat successful writes", async () => {
  const vm = createModel();
  const calls = [];
  let failTeam = true;
  vm.stageViewAccess(user, 3);
  vm.stageViewAccess(team, 0);
  const service = {
    updateViewAccess: async (_id, principal, mask) => {
      calls.push([principal.id, mask]);
      if (principal.id === team.id && failTeam) throw new Error("Denied");
    },
    getViewAccess: async () => [{ ...user, accessRightsMask: 3 }],
  };
  await assert.rejects(vm.saveViewAccess(service), /Example team.*Denied/);
  assert.equal(vm.pendingAccess.size, 1);
  assert.equal(vm.viewAccess[0].accessRightsMask, 3);
  assert.equal(vm.isSavingViewAccess, false);
  failTeam = false;
  await vm.saveViewAccess(service);
  assert.deepEqual(calls, [[user.id, 3], [team.id, 0], [team.id, 0]]);
  assert.equal(vm.hasAccessChanges, false);
});

test("reload failure reports saved changes accurately without retrying writes", async () => {
  const vm = createModel();
  vm.stageViewAccess(user, 3);
  await assert.rejects(vm.saveViewAccess({
    updateViewAccess: async () => {},
    getViewAccess: async () => { throw new Error("Read failed"); },
  }), /were saved, but reloading access failed/);
  assert.equal(vm.hasAccessChanges, false);
  assert.equal(vm.viewAccess[0].accessRightsMask, 3);
  assert.equal(vm.accessNavigationLocked, false);
});

test("pending edits block navigation; in-flight saves block duplicate writes and edits", async () => {
  const vm = createModel();
  vm.stageViewAccess(user, 3);
  vm.setSelectedOwner(team.id);
  assert.equal(vm.selectedOwnerId, null);
  await vm.selectView({}, null);
  await vm.loadPersonalViews({}, null);
  assert.equal(vm.selectedView.id, viewId);
  const wait = deferred();
  let calls = 0;
  const service = {
    updateViewAccess: async () => { calls++; await wait.promise; },
    getViewAccess: async () => [{ ...user, accessRightsMask: 3 }, team],
  };
  const saving = vm.saveViewAccess(service);
  assert.equal(vm.isSavingViewAccess, true);
  assert.equal(await vm.saveViewAccess(service), false);
  assert.equal(calls, 1);
  assert.throws(() => vm.stageViewAccess(user, 1), /finish saving/);
  assert.throws(() => vm.discardAccessChanges(), /finish saving/);
  wait.resolve();
  await saving;
});

test("stale reloads and saves without a selection do not report success", async () => {
  const vm = createModel();
  vm.clearSelectedView();
  assert.equal(await vm.saveViewAccess({}), false);
  vm.selectedView = view;
  vm.viewAccess = [user];
  vm.stageViewAccess(user, 3);
  const reload = deferred();
  const reloadStarted = deferred();
  const saving = vm.saveViewAccess({
    updateViewAccess: async () => {},
    getViewAccess: async () => {
      reloadStarted.resolve();
      return reload.promise;
    },
  });
  await reloadStarted.promise;
  vm.clearSelectedView();
  reload.resolve([{ ...user, accessRightsMask: 3 }]);
  assert.equal(await saving, false);
  assert.equal(vm.viewAccess.length, 0);
});

test("connection reset stops remaining writes and never restores stale access", async () => {
  const vm = createModel();
  vm.stageViewAccess(user, 3);
  vm.stageViewAccess(team, 3);
  const wait = deferred();
  let calls = 0;
  const saving = vm.saveViewAccess({
    updateViewAccess: async () => { calls++; await wait.promise; },
  });
  await vm.loadUsers({ getActiveUsers: async () => [] });
  wait.resolve();
  await assert.rejects(saving, /view or connection changed/);
  assert.equal(calls, 1);
  assert.equal(vm.selectedView, null);
  assert.equal(vm.viewAccess.length, 0);
  assert.equal(vm.viewAccessSaveError, null);
  assert.equal(vm.isSavingViewAccess, false);
});
