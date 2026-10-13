const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ViewModel,
  dvService,
  viewId,
  user,
  newUser,
  view,
  createModel,
  deferred,
} = require("./helpers.cjs");

test("all owners waits for a table; table changes and refresh query only that table", async () => {
  const vm = new ViewModel();
  const calls = [];
  const service = {
    getActiveUsers: async () => [{ ...newUser, isCurrentUser: true }],
    getTables: async () => [
      { logicalName: "account", name: "Account (account)" },
      { logicalName: "contact", name: "Contact (contact)" },
    ],
    getPersonalViews: async (...args) => { calls.push(args); return [view]; },
  };
  await vm.loadUsers(service);
  assert.equal(vm.selectedOwnerId, newUser.id);
  await vm.loadPersonalViews(service, vm.selectedOwnerId);
  assert.deepEqual(calls, [[newUser.id, null]]);
  vm.setSelectedOwner(null);
  assert.equal(vm.canLoadPersonalViews, false);
  assert.equal(vm.isLoadingPersonalViews, false);
  await vm.loadPersonalViews(service, null);
  assert.equal(calls.length, 1);
  assert.equal(vm.personalViews.length, 0);
  await vm.loadTables(service);
  vm.setSelectedTable("account");
  assert.equal(vm.canLoadPersonalViews, true);
  await vm.loadPersonalViews(service, null);
  await vm.loadPersonalViews(service, null);
  assert.deepEqual(calls.slice(1), [[null, "account"], [null, "account"]]);
  vm.selectedView = view;
  vm.viewAccess = [user];
  vm.setSelectedTable("contact");
  assert.equal(vm.selectedView, null);
  assert.equal(vm.viewAccess.length, 0);
  assert.equal(vm.personalViews.length, 0);
  await vm.loadPersonalViews(service, null);
  assert.deepEqual(calls.at(-1), [null, "contact"]);
  vm.setSelectedOwner(user.id);
  assert.equal(vm.selectedTableLogicalName, null);
  await vm.loadPersonalViews(service, user.id);
  assert.deepEqual(calls.at(-1), [user.id, null]);
  vm.setSelectedOwner(null);
  assert.equal(vm.canLoadPersonalViews, false);
  assert.throws(() => vm.setSelectedTable("unknown"), /available Dataverse table/);
});

test("table navigation and refresh preserve pending edits and active saves", async () => {
  const vm = createModel();
  vm.tables = [{ logicalName: "account", name: "Account" }, { logicalName: "contact", name: "Contact" }];
  vm.selectedTableLogicalName = "account";
  vm.stageViewAccess(user, 3);
  vm.setSelectedTable("contact");
  await vm.loadPersonalViews({}, null);
  assert.equal(vm.selectedTableLogicalName, "account");
  assert.equal(vm.selectedView.id, viewId);
  vm.discardAccessChanges();
  vm.isSavingViewAccess = true;
  vm.setSelectedTable("contact");
  await vm.loadPersonalViews({}, null);
  assert.equal(vm.selectedTableLogicalName, "account");
  assert.equal(vm.selectedView.id, viewId);
});

test("changing tables ignores stale view results", async () => {
  const vm = new ViewModel();
  vm.tables = [{ logicalName: "account", name: "Account" }, { logicalName: "contact", name: "Contact" }];
  vm.setSelectedTable("account");
  const wait = deferred();
  const loading = vm.loadPersonalViews({ getPersonalViews: () => wait.promise }, null);
  vm.setSelectedTable("contact");
  await vm.loadPersonalViews({ getPersonalViews: async () => [] }, null);
  wait.resolve([view]);
  await loading;
  assert.equal(vm.personalViews.length, 0);
  assert.equal(vm.selectedTableLogicalName, "contact");
  assert.equal(vm.isLoadingPersonalViews, false);
});

test("table loading shares in-flight work, reports failures, retries and resets on connection changes", async () => {
  const vm = new ViewModel();
  const wait = deferred();
  const loading = vm.loadTables({ getTables: () => wait.promise });
  await vm.loadTables({ getTables: () => assert.fail("Duplicate metadata load") });
  await vm.loadUsers({ getActiveUsers: async () => [] });
  wait.resolve([{ logicalName: "old", name: "Old table" }]);
  await loading;
  assert.equal(vm.tables.length, 0);
  assert.equal(vm.hasLoadedTables, false);
  await assert.rejects(vm.loadTables({ getTables: async () => { throw new Error("Metadata denied"); } }), /Metadata denied/);
  assert.equal(vm.tablesError, "Metadata denied");
  assert.equal(vm.isLoadingTables, false);
  await vm.loadTables({ getTables: async () => [{ logicalName: "account", name: "Account" }] });
  assert.equal(vm.tablesError, null);
  assert.equal(vm.hasLoadedTables, true);
  vm.setSelectedTable("account");
  await vm.loadUsers({ getActiveUsers: async () => [] });
  assert.equal(vm.selectedTableLogicalName, null);
  assert.equal(vm.tables.length, 0);
});

test("table picker includes all metadata tables and shares the display-name cache with views", async () => {
  let metadataCalls = 0;
  const queries = [];
  const service = new dvService({
    connection: null,
    onLog: () => {},
    dvApi: {
      getAllEntitiesMetadata: async (properties) => {
        metadataCalls++;
        assert.deepEqual(properties, ["LogicalName", "DisplayName", "ObjectTypeCode"]);
        return { value: [
          { LogicalName: "contact", ObjectTypeCode: 2, DisplayName: { LocalizedLabels: [{ Label: "Contact" }] } },
          { LogicalName: "account", ObjectTypeCode: 1, DisplayName: { LocalizedLabels: [{ Label: "Account" }] } },
          { LogicalName: "custom_empty", ObjectTypeCode: 10427 },
        ] };
      },
      fetchXmlQuery: async (query) => {
        queries.push(query);
        return { value: [{ userqueryid: viewId, name: view.name, returnedtypecode: "account" }] };
      },
    },
  });
  assert.deepEqual(await service.getTables(), [
    { logicalName: "account", name: "Account (account)" },
    { logicalName: "contact", name: "Contact (contact)" },
    { logicalName: "custom_empty", name: "custom_empty (custom_empty)" },
  ]);
  const views = await service.getPersonalViews(null, "account");
  assert.equal(views[0].tableName, "Account (account)");
  assert.match(queries[0], /<condition attribute="returnedtypecode" operator="eq" value="1" \/>/);
  assert.doesNotMatch(queries[0], /<condition attribute="ownerid"/);
  await service.getPersonalViews(user.id, "contact");
  assert.match(queries[1], new RegExp(`<condition attribute="ownerid" operator="eq" value="${user.id}"`));
  assert.doesNotMatch(queries[1], /<condition attribute="returnedtypecode"/);
  assert.equal(metadataCalls, 1);
  for (const invalid of [null, "", 'account" />', "<account>"]) {
    await assert.rejects(service.getPersonalViews(null, invalid), /valid Dataverse table/);
  }
  assert.equal(queries.length, 2);
  await service.getPersonalViews(null, "custom_empty");
  assert.match(queries[2], /<condition attribute="returnedtypecode" operator="eq" value="10427" \/>/);
  assert.equal(metadataCalls, 1);
});

test("missing or invalid table object type codes are logged without querying views", async () => {
  for (const code of [undefined, null, "1", 0, -1, 1.5, NaN, Infinity]) {
    const logs = [];
    const service = new dvService({
      connection: null,
      onLog: (...args) => logs.push(args),
      dvApi: {
        getAllEntitiesMetadata: async () => ({
          value: [{ LogicalName: "account", ObjectTypeCode: code }],
        }),
        fetchXmlQuery: async () => assert.fail("Invalid table metadata must not query views"),
      },
    });
    await assert.rejects(service.getPersonalViews(null, "account"), /valid ObjectTypeCode/);
    await assert.rejects(service.getPersonalViews(null, "unknown"), /valid ObjectTypeCode/);
    assert.equal(logs.length, 2);
    assert.ok(logs.every(([, level]) => level === "error"));
  }
});

test("failed table metadata requests are logged and can be retried", async () => {
  const logs = [];
  let calls = 0;
  const service = new dvService({
    connection: null,
    onLog: (...args) => logs.push(args),
    dvApi: {
      getAllEntitiesMetadata: async () => {
        if (++calls === 1) throw new Error("Metadata unavailable");
        return { value: [] };
      },
    },
  });
  await assert.rejects(service.getTables(), /Metadata unavailable/);
  assert.match(logs[0][0], /getAllEntitiesMetadata.*Metadata unavailable/);
  assert.equal(logs[0][1], "error");
  assert.deepEqual(await service.getTables(), []);
  assert.equal(calls, 2);
});
