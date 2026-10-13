const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createService, createPersonalCopyModel, createPersonalCopyService, deferred,
  systemView, secondView, newUser, anotherUser, viewDefinition, viewId,
} = require("./helpers.cjs");

const secondSystemView = { ...systemView, id: secondView.id, name: secondView.name };

test("system definition reads supported fields from savedquery and resolves numeric table codes", async () => {
  const { service, logs } = createService();
  service.dvApi.getAllEntitiesMetadata = async () => ({
    value: [{ LogicalName: "account", ObjectTypeCode: 1 }],
  });
  service.dvApi.retrieve = async (entity, id, columns) => {
    assert.equal(entity, "savedquery");
    assert.equal(id, systemView.id);
    assert.deepEqual(columns, [
      "name", "returnedtypecode", "fetchxml", "layoutxml",
      "description", "columnsetxml", "layoutjson", "conditionalformatting", "advancedgroupby",
    ]);
    return {
      ...viewDefinition,
      returnedtypecode: 1,
      columnsetxml: "<columns />",
      layoutjson: "{}",
      ownerid: viewId,
    };
  };
  assert.deepEqual(await service.getSystemViewDefinition(systemView.id), {
    ...viewDefinition,
    returnedtypecode: "account",
    columnsetxml: "<columns />",
    layoutjson: "{}",
  });
  assert.equal(logs.length, 2);
  assert.equal(logs[0][1], "info");
  assert.match(logs[0][0], /dataverseAPI\.retrieve\("savedquery"/);
  assert.ok(logs[0][0].includes(systemView.id));
  assert.match(logs[1][0], /fetchxml=string \(\d+ chars\)/);
  assert.match(logs[1][0], /layoutxml=string \(\d+ chars\)/);
});

test("system-copy diagnostics identify which required definition fields are absent", async () => {
  const { service, logs } = createService();
  service.dvApi.retrieve = async () => ({
    name: "My Listings",
    returnedtypecode: "account",
    fetchxml: undefined,
    layoutxml: "  ",
  });
  await assert.rejects(
    service.getSystemViewDefinition(systemView.id),
    /missing or blank FetchXML, layout XML/,
  );
  assert.match(logs[0][0], /Copy source request:.*retrieve\("savedquery"/);
  assert.match(logs[1][0], /fetchxml=missing, layoutxml=string \(2 chars, blank\)/);
  assert.equal(logs[0][1], "info");
  assert.equal(logs[1][1], "info");
  assert.equal(logs[2][1], "error");
});

test("personal-copy existence checks and creation use the stable ID and selected owner", async () => {
  const { service, logs } = createService();
  const ids = [];
  const ownerId = newUser.id;
  service.dvApi.fetchXmlQuery = async (xml) => {
    assert.match(xml, /<entity name="userquery"><attribute name="userqueryid"/);
    assert.ok(xml.includes(`attribute="userqueryid" operator="eq" value="${viewId}"`));
    return { value: [{ userqueryid: viewId }] };
  };
  assert.equal(await service.personalViewExists(viewId), true);
  service.dvApi.create = async (...args) => { ids.push(args); };
  await service.createPersonalView(viewId, viewDefinition, ownerId);
  assert.deepEqual(ids, [["userquery", {
    ...viewDefinition,
    userqueryid: viewId,
    querytype: 0,
    "ownerid@odata.bind": `/systemusers(${ownerId})`,
  }]]);
  await assert.rejects(service.createPersonalView(viewId, viewDefinition, "invalid"), /owner ID is invalid/);
  assert.equal(ids.length, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /owner ID is invalid/);
});

test("selected system views copy to the selected user and lock navigation until completion", async () => {
  const vm = createPersonalCopyModel();
  const operation = vm.copySystemViewToPersonal;
  const calls = [];
  const ownerId = anotherUser.id;
  operation.selectOwner(ownerId, [newUser, anotherUser]);
  const service = createPersonalCopyService({
    personalViewExists: async (id) => { calls.push(["exists", id]); return false; },
    getSystemViewDefinition: async (id) => { calls.push(["retrieve", id]); return viewDefinition; },
    createPersonalView: async (id, definition, owner) => {
      calls.push(["create", id, owner]);
      assert.deepEqual(definition, viewDefinition);
    },
  });
  const id = operation.copies[0].personalViewId;
  assert.notEqual(id, systemView.id);
  assert.equal(vm.accessNavigationLocked, true);
  vm.setActiveTab("personal");
  assert.equal(vm.activeTab, "system");
  assert.equal(await operation.copyToPersonal(service), true);
  assert.deepEqual(calls, [["exists", id], ["retrieve", systemView.id], ["create", id, ownerId]]);
  assert.equal(operation.isOpen, false);
  assert.equal(vm.accessNavigationLocked, false);
  assert.deepEqual(vm.systemViews, [systemView]);
});

test("lost create responses recover the existing personal view without duplicating it", async () => {
  const operation = createPersonalCopyModel().copySystemViewToPersonal;
  const existing = new Set();
  let creates = 0;
  const service = createPersonalCopyService({
    personalViewExists: async (id) => existing.has(id),
    createPersonalView: async (id) => {
      creates++;
      existing.add(id);
      throw new Error("Response connection lost");
    },
  });
  const id = operation.copies[0].personalViewId;
  await assert.rejects(operation.copyToPersonal(service), /Response connection lost/);
  assert.ok(operation.error);
  assert.equal(await operation.copyToPersonal(service), true);
  assert.equal(creates, 1);
  assert.equal(operation.isOpen, false);
});

test("system-view copy failures remain retryable with the same owner and ID", async () => {
  const operation = createPersonalCopyModel().copySystemViewToPersonal;
  let fail = true;
  const service = createPersonalCopyService({
    createPersonalView: async () => {
      if (fail) throw new Error("Insufficient create privileges");
    },
  });
  const id = operation.copies[0].personalViewId;
  await assert.rejects(operation.copyToPersonal(service), /Insufficient create privileges/);
  assert.equal(operation.copies[0].personalViewId, id);
  assert.equal(operation.lockedOwnerId, newUser.id);
  assert.throws(() => operation.selectOwner(anotherUser.id, [newUser, anotherUser]), /same owner/);
  assert.equal(operation.isCopying, false);
  assert.match(operation.error, /Could not copy/);
  fail = false;
  assert.equal(await operation.copyToPersonal(service), true);
});

test("missing CreateAccess privilege is shown as a concise actionable message", async () => {
  const operation = createPersonalCopyModel().copySystemViewToPersonal;
  const service = createPersonalCopyService({
    createPersonalView: async () => {
      throw new Error("0x80048306: user does not have CreateAccess. More details: {very long platform payload}");
    },
  });
  await assert.rejects(
    operation.copyToPersonal(service),
    /0 of 1 views copied.*Could not copy "System view".*lacks the Create privilege.*administrator/,
  );
  assert.doesNotMatch(operation.error, /80048306|very long platform payload|Owner [0-9a-f-]{36}/i);
});

test("multiple system views copy sequentially to one selected owner and retry only incomplete views", async () => {
  const operation = createPersonalCopyModel([systemView, secondSystemView]).copySystemViewToPersonal;
  const ids = operation.copies.map((copy) => copy.personalViewId);
  const calls = [];
  let failSecond = true;
  const service = createPersonalCopyService({
    personalViewExists: async (id) => { calls.push(["exists", id]); return false; },
    getSystemViewDefinition: async (id) => {
      calls.push(["retrieve", id]);
      return { ...viewDefinition, name: id === secondSystemView.id ? secondSystemView.name : systemView.name };
    },
    createPersonalView: async (id, definition, ownerId) => {
      calls.push(["create", id, ownerId]);
      assert.equal(definition.name, id === ids[0] ? systemView.name : secondSystemView.name);
      if (id === ids[1] && failSecond) throw new Error("Create denied");
    },
  });
  await assert.rejects(operation.copyToPersonal(service), /1 of 2 views.*Second view.*Create denied/);
  assert.equal(operation.copies[0].completed, true);
  assert.equal(operation.copies[1].completed, false);
  assert.equal(operation.lockedOwnerId, newUser.id);
  assert.deepEqual(calls, [
    ["exists", ids[0]], ["retrieve", systemView.id], ["create", ids[0], newUser.id],
    ["exists", ids[1]], ["retrieve", secondSystemView.id], ["create", ids[1], newUser.id],
  ]);
  failSecond = false;
  assert.equal(await operation.copyToPersonal(service), true);
  assert.deepEqual(calls.slice(6), [
    ["exists", ids[1]], ["create", ids[1], newUser.id],
  ]);
});

test("copy requires an active user and rejects stale owner selections", async () => {
  const operation = createPersonalCopyModel().copySystemViewToPersonal;
  operation.selectedOwnerId = null;
  await assert.rejects(operation.copyToPersonal(createPersonalCopyService()), /Select an active user/);
  assert.throws(() => operation.selectOwner("invalid", [newUser]), /available active user/);
});

test("reset during a pending personal-view check invalidates the copy operation", async () => {
  const operation = createPersonalCopyModel().copySystemViewToPersonal;
  const pending = deferred();
  const calls = [];
  const service = createPersonalCopyService({
    personalViewExists: async () => { calls.push("exists"); return pending.promise; },
    getSystemViewDefinition: async () => { calls.push("retrieve"); return viewDefinition; },
    createPersonalView: async () => { calls.push("create"); },
  });
  const saving = operation.copyToPersonal(service);
  operation.reset();
  pending.resolve(false);
  assert.equal(await saving, false);
  assert.deepEqual(calls, ["exists"]);
  assert.equal(operation.isOpen, false);
  assert.equal(operation.error, null);
});
