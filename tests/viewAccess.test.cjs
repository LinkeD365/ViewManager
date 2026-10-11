const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

// Exercise the TypeScript model/service without loading React or the PPTB host.
const modules = new Map();
function loadSource(filename) {
  const absolute = path.resolve(__dirname, "..", filename);
  if (modules.has(absolute)) return modules.get(absolute);
  const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => name.startsWith(".")
      ? loadSource(path.resolve(path.dirname(absolute), `${name}.tsx`))
      : require(name),
    module,
    module.exports,
  );
  modules.set(absolute, module.exports);
  return module.exports;
}

const { ViewModel, accessRights, formatAccessRights, selectableAccessRights, getAccessMaskFromSelection } = loadSource("src\\model\\viewModel.tsx");
const { dvService } = loadSource("src\\services\\dataverseService.tsx");
const viewId = "33bc5942-dbee-ef11-be20-6045bded7daf";
const user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Example user", principalType: "User", accessRightsMask: 1 };
const team = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Example team", principalType: "Team", accessRightsMask: 1 };
const view = { id: viewId, name: "Test view", entityName: "account", tableName: "Account (account)", ownerId: user.id, ownerName: user.name, modifiedOn: "", description: "" };

function createService(execute = async () => ({})) {
  const logs = [];
  const service = new dvService({ connection: null, dvApi: { execute }, onLog: (...entry) => logs.push(entry) });
  return { service, logs };
}

function createModel() {
  const vm = new ViewModel();
  vm.selectedView = view;
  vm.viewAccess = [user, team];
  vm.personalViews = [view];
  return vm;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("all documented mask combinations produce the correct action and enum members", async () => {
  let request;
  const { service, logs } = createService(async (value) => { request = value; return {}; });
  for (let bits = 0; bits < 256; bits++) {
    const rights = accessRights.filter((_, index) => (bits & (1 << index)) !== 0);
    const mask = rights.reduce((sum, [value]) => sum + value, 0);
    await service.updateViewAccess(viewId, user, mask);
    assert.equal(request.operationType, "action");
    assert.deepEqual(request.parameters.Target, { "@odata.type": "Microsoft.Dynamics.CRM.userquery", userqueryid: viewId });
    const principal = { "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: user.id };
    if (mask === 0) {
      assert.equal(request.operationName, "RevokeAccess");
      assert.deepEqual(request.parameters.Revokee, principal);
    } else {
      assert.equal(request.operationName, "ModifyAccess");
      assert.deepEqual(request.parameters.PrincipalAccess, { Principal: principal, AccessMask: rights.map(([, , name]) => name).join(",") });
    }
    assert.equal(formatAccessRights(mask), rights.length ? rights.map(([, label]) => label).join(", ") : "None");
  }
  await service.updateViewAccess(viewId, team, 3);
  assert.deepEqual(request.parameters.PrincipalAccess.Principal, { "@odata.type": "Microsoft.Dynamics.CRM.team", teamid: team.id });
  await service.updateViewAccess(viewId, team, 0);
  assert.deepEqual(request.parameters.Revokee, { "@odata.type": "Microsoft.Dynamics.CRM.team", teamid: team.id });
  assert.equal(logs.length, 0);
});

test("permission picker hides create/append rights and preserves their existing bits", () => {
  assert.deepEqual(selectableAccessRights.map(([, label]) => label), ["Read", "Write", "Delete", "Share", "Assign"]);
  for (const hidden of [0, 4, 16, 32, 20, 36, 48, 52]) {
    for (let selection = 0; selection < 32; selection++) {
      const selected = selectableAccessRights.filter((_, index) => (selection & (1 << index)) !== 0);
      const expected = selected.reduce((mask, [value]) => mask | value, hidden);
      assert.equal(getAccessMaskFromSelection(hidden | 3, selected.map(([value]) => String(value))), expected);
    }
  }
  assert.equal(getAccessMaskFromSelection(3, []), 0);
  assert.equal(getAccessMaskFromSelection(55, []), 52);
  assert.equal(getAccessMaskFromSelection(1, ["4", "16", "32"]), 0);
});

test("invalid mutations and API failures are logged and rejected", async () => {
  let calls = 0;
  const { service, logs } = createService(async () => { calls++; return {}; });
  for (const mask of [-1, 8, 1.5, NaN, 2 ** 32]) {
    await assert.rejects(service.updateViewAccess(viewId, user, mask), /invalid or unsupported/);
  }
  await assert.rejects(service.updateViewAccess("invalid", user, 1), /ID is invalid/);
  await assert.rejects(service.updateViewAccess(viewId, { ...user, principalType: "Organization" }, 1), /Only users and teams/);
  assert.equal(calls, 0);
  assert.equal(logs.length, 7);
  assert.ok(logs.every(([, level]) => level === "error"));
  const error = new Error("Insufficient privileges");
  const failed = createService(async () => { throw error; });
  await assert.rejects(failed.service.updateViewAccess(viewId, team, 3), (actual) => actual === error);
  assert.match(failed.logs[0][0], /ModifyAccess.*Insufficient privileges/);
});

test("staging is local, zero is retained, restoring original values and discard clear dirty state", () => {
  const vm = createModel();
  vm.stageViewAccess(user, 3);
  assert.equal(vm.viewAccess[0].accessRightsMask, 1);
  assert.equal(vm.displayedViewAccess[0].accessRightsMask, 3);
  assert.equal(vm.hasAccessChanges, true);
  vm.stageViewAccess(user, 1);
  assert.equal(vm.hasAccessChanges, false);
  vm.stageViewAccess(team, 0);
  assert.equal(vm.displayedViewAccess[1].accessRightsMask, 0);
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
  await vm.saveViewAccess(service);
  assert.deepEqual(calls.map(([id, principal, mask]) => [id, principal.id, mask]), [[viewId, user.id, 3], [viewId, team.id, 0]]);
  assert.equal(vm.viewAccess.length, 1);
  assert.equal(vm.viewAccess[0].accessRightsMask, 3);
  assert.equal(vm.hasAccessChanges, false);
  assert.equal(vm.isSavingViewAccess, false);
  assert.equal(vm.viewAccessSaveMessage, "Access changes saved.");
  await vm.saveViewAccess(service);
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
  assert.equal(vm.viewAccessSaveMessage, null);
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
  assert.equal(vm.viewAccessSaveMessage, null);
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
  await vm.saveViewAccess(service);
  assert.equal(calls, 1);
  assert.throws(() => vm.stageViewAccess(user, 1), /finish saving/);
  assert.throws(() => vm.discardAccessChanges(), /finish saving/);
  wait.resolve();
  await saving;
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
