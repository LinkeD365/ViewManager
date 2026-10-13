const assert = require("node:assert/strict");
const test = require("node:test");
const {
  accessRights,
  formatAccessRights,
  selectableAccessRights,
  getAccessMaskFromSelection,
  viewId,
  user,
  team,
  newUser,
  createService,
} = require("./helpers.cjs");

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

test("GrantAccess uses a typed user and mask, and rejects empty grants", async () => {
  let request;
  const { service, logs } = createService(async (value) => { request = value; return {}; });
  await service.grantViewAccess(viewId, { ...user, id: newUser.id }, 3);
  assert.equal(request.operationName, "GrantAccess");
  assert.deepEqual(request.parameters, {
    Target: { "@odata.type": "Microsoft.Dynamics.CRM.userquery", userqueryid: viewId },
    PrincipalAccess: {
      Principal: { "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: newUser.id },
      AccessMask: "ReadAccess,WriteAccess",
    },
  });
  await assert.rejects(service.grantViewAccess(viewId, user, 0), /at least one permission/);
  assert.match(logs[0][0], /GrantAccess/);
});
