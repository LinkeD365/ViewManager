const assert = require("node:assert/strict");
const test = require("node:test");
const {
  viewId,
  user,
  team,
  newUser,
  anotherUser,
  createModel,
} = require("./helpers.cjs");

test("user picker excludes existing and pending users regardless of ID casing", async () => {
  const vm = createModel();
  vm.activeUsers = [{ ...user, id: user.id.toUpperCase(), isCurrentUser: false }, newUser, anotherUser];
  assert.deepEqual(vm.availableAccessUsers.map((entry) => entry.id), [newUser.id, anotherUser.id]);
  vm.beginAddAccessUser();
  assert.equal(vm.hasNewUserRow, true);
  assert.equal(vm.accessNavigationLocked, true);
  await assert.rejects(vm.saveViewAccess({}), /Choose a user/);
  assert.throws(() => vm.selectAccessUser(user.id), /already in the access grid/);
  vm.selectAccessUser(newUser.id.toUpperCase());
  assert.equal(vm.hasNewUserRow, false);
  assert.equal(vm.displayedViewAccess[2].accessRightsMask, 1);
  assert.deepEqual(vm.availableAccessUsers.map((entry) => entry.id), [anotherUser.id]);
  vm.beginAddAccessUser();
  assert.throws(() => vm.selectAccessUser(newUser.id), /already in the access grid/);
  vm.cancelAddAccessUser();
  assert.equal(vm.newViewAccess.length, 1);
  vm.discardAccessChanges();
  assert.equal(vm.newViewAccess.length, 0);
  assert.equal(vm.accessNavigationLocked, false);
});

test("new user rights can be changed or removed locally and reset on connection changes", () => {
  const vm = createModel();
  vm.activeUsers = [newUser];
  vm.beginAddAccessUser();
  vm.selectAccessUser(newUser.id);
  const added = vm.newViewAccess[0];
  vm.stageViewAccess(added, 3);
  assert.equal(vm.displayedViewAccess[2].accessRightsMask, 3);
  assert.notEqual(vm.newViewAccess[0], added);
  vm.stageViewAccess(added, 0);
  assert.equal(vm.hasAccessChanges, false);
  assert.equal(vm.availableAccessUsers.length, 1);
  vm.beginAddAccessUser();
  vm.selectAccessUser(newUser.id);
  vm.clearSelectedView();
  assert.equal(vm.newViewAccess.length, 0);
  assert.equal(vm.hasNewUserRow, false);
  assert.throws(() => vm.beginAddAccessUser(), /records are ready/);
});

test("mixed saves update existing shares and grant new users; retry only grants remaining additions", async () => {
  const vm = createModel();
  vm.activeUsers = [newUser, anotherUser];
  for (const entry of vm.activeUsers) {
    vm.beginAddAccessUser();
    vm.selectAccessUser(entry.id);
  }
  vm.stageViewAccess(user, 3);
  const calls = [];
  let fail = true;
  const service = {
    updateViewAccess: async (_id, principal, mask) => { calls.push(["update", principal.id, mask]); },
    grantViewAccess: async (id, principal, mask) => {
      assert.equal(id, viewId);
      calls.push(["grant", principal.id, mask]);
      if (principal.id === anotherUser.id && fail) throw new Error("Grant denied");
    },
    getViewAccess: async () => vm.viewAccess.slice(),
  };
  await assert.rejects(vm.saveViewAccess(service), /Grant denied/);
  assert.deepEqual(vm.newViewAccess.map((entry) => entry.id), [anotherUser.id]);
  assert.equal(vm.viewAccess.some((entry) => entry.id === newUser.id), true);
  fail = false;
  assert.equal(await vm.saveViewAccess(service), true);
  assert.deepEqual(calls, [["update", user.id, 3], ["grant", newUser.id, 1], ["grant", anotherUser.id, 1], ["grant", anotherUser.id, 1]]);
  assert.equal(vm.hasAccessChanges, false);
});

test("delete stages a full user revoke, supports discard and saves only that user", async () => {
  const vm = createModel();
  const original = { ...user, accessRightsMask: 61 };
  vm.viewAccess = [original, team];
  vm.removeViewAccess(original);
  assert.equal(vm.viewAccess[0].accessRightsMask, 61);
  assert.deepEqual(vm.displayedViewAccess.map((entry) => entry.id), [team.id]);
  vm.discardAccessChanges();
  assert.equal(vm.displayedViewAccess[0].accessRightsMask, 61);
  vm.removeViewAccess(original);
  const calls = [];
  await vm.saveViewAccess({
    updateViewAccess: async (...args) => { calls.push(args); },
    getViewAccess: async () => [team],
  });
  assert.deepEqual(calls.map(([id, principal, mask]) => [id, principal.id, mask]), [[viewId, user.id, 0]]);
  assert.deepEqual(vm.viewAccess.map((entry) => entry.id), [team.id]);
  assert.equal(vm.hasAccessChanges, false);
});

test("failed removal stays hidden and pending until discard restores the row", async () => {
  const vm = createModel();
  vm.removeViewAccess(user);
  await assert.rejects(vm.saveViewAccess({
    updateViewAccess: async () => { throw new Error("Revoke denied"); },
  }), /Revoke denied/);
  assert.deepEqual(vm.displayedViewAccess.map((entry) => entry.id), [team.id]);
  assert.equal(vm.viewAccess[0].accessRightsMask, 1);
  assert.equal(vm.hasAccessChanges, true);
  vm.discardAccessChanges();
  assert.deepEqual(vm.displayedViewAccess.map((entry) => entry.id), [user.id, team.id]);
});

test("re-adding a removed user displays only the new row and revokes before granting", async () => {
  const vm = createModel();
  vm.activeUsers = [{ id: user.id, name: user.name, isCurrentUser: false }];
  vm.removeViewAccess(user);
  vm.beginAddAccessUser();
  vm.selectAccessUser(user.id);
  assert.equal(vm.displayedViewAccess.filter((entry) => entry.id === user.id).length, 1);
  const calls = [];
  await vm.saveViewAccess({
    updateViewAccess: async (_id, principal, mask) => calls.push(["revoke", principal.id, mask]),
    grantViewAccess: async (_id, principal, mask) => calls.push(["grant", principal.id, mask]),
    getViewAccess: async () => [user, team],
  });
  assert.deepEqual(calls, [["revoke", user.id, 0], ["grant", user.id, 1]]);
});

test("delete of a pending new user cancels addition without any server call", async () => {
  const vm = createModel();
  vm.activeUsers = [newUser];
  vm.beginAddAccessUser();
  vm.selectAccessUser(newUser.id);
  vm.removeViewAccess(vm.newViewAccess[0]);
  assert.equal(vm.newViewAccess.length, 0);
  assert.equal(vm.availableAccessUsers.length, 1);
  assert.equal(await vm.saveViewAccess({}), false);
});

test("delete rejects teams, stale users and changes during saving", () => {
  const vm = createModel();
  assert.throws(() => vm.removeViewAccess(team), /Select a user/);
  assert.throws(() => vm.removeViewAccess({ ...user, id: newUser.id }), /no longer/);
  vm.isSavingViewAccess = true;
  assert.throws(() => vm.removeViewAccess(user), /finish saving/);
  vm.isSavingViewAccess = false;
  vm.clearSelectedView();
  assert.throws(() => vm.removeViewAccess(user), /Select a user/);
});
