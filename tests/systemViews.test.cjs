const assert = require("node:assert/strict");
const test = require("node:test");
const { ViewModel, dvService, view, user, createModel, deferred } = require("./helpers.cjs");

const systemView = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Active accounts",
  entityName: "account",
  tableName: "Account (account)",
  modifiedOn: "2026-10-12T10:00:00Z",
  description: "Active account records",
};
const tables = [
  { logicalName: "account", name: "Account (account)" },
  { logicalName: "contact", name: "Contact (contact)" },
];

test("tabs default to personal and retain independent filters, selections and results", () => {
  const vm = createModel();
  vm.tables = tables;
  vm.selectedViews = [view];
  vm.selectedOwnerId = user.id;
  assert.equal(vm.activeTab, "personal");
  vm.setActiveTab("system");
  assert.equal(vm.activeTab, "system");
  assert.equal(vm.selectedSystemTableLogicalName, null);
  vm.setSelectedSystemTable("contact");
  vm.systemViews = [systemView];
  vm.setActiveTab("personal");
  assert.equal(vm.selectedOwnerId, user.id);
  assert.equal(vm.selectedView.id, view.id);
  assert.equal(vm.selectedViews.length, 1);
  assert.deepEqual(vm.personalViews, [view]);
  vm.setActiveTab("system");
  assert.equal(vm.selectedSystemTableLogicalName, "contact");
  assert.deepEqual(vm.systemViews, [systemView]);
});

test("tab switching is blocked by pending edits, saves and bulk dialogs", () => {
  const vm = createModel();
  vm.stageViewAccess(user, 3);
  vm.setActiveTab("system");
  assert.equal(vm.activeTab, "personal");
  vm.discardAccessChanges();
  for (const flag of ["isSavingViewAccess", "isChangingOwner", "isSavingBulkAccess"]) {
    vm[flag] = true;
    vm.setActiveTab("system");
    assert.equal(vm.activeTab, "personal");
    vm[flag] = false;
  }
  for (const field of ["ownerChangeViews", "bulkAccessViews"]) {
    vm[field] = [view];
    vm.setActiveTab("system");
    assert.equal(vm.activeTab, "personal");
    vm[field] = [];
  }
  vm.setActiveTab("system");
  assert.equal(vm.activeTab, "system");
});

test("system view loading waits for a table and refresh uses only the system table", async () => {
  const vm = new ViewModel();
  vm.tables = tables;
  vm.selectedTableLogicalName = "contact";
  await vm.loadSystemViews({ getSystemViews: () => assert.fail("No table selected") });
  assert.equal(vm.isLoadingSystemViews, false);
  assert.throws(() => vm.setSelectedSystemTable("missing"), /available Dataverse table/);
  vm.setSelectedSystemTable("account");
  assert.equal(vm.isLoadingSystemViews, true);
  const calls = [];
  const service = { getSystemViews: async (table) => { calls.push(table); return [systemView]; } };
  await vm.loadSystemViews(service);
  await vm.loadSystemViews(service);
  assert.deepEqual(calls, ["account", "account"]);
  assert.deepEqual(vm.systemViews, [systemView]);
  assert.equal(vm.selectedTableLogicalName, "contact");
  assert.equal(vm.isLoadingSystemViews, false);
  vm.setSelectedSystemTable("contact");
  assert.equal(vm.systemViews.length, 0);
  await vm.loadSystemViews({ getSystemViews: async () => [] });
  assert.equal(vm.systemViews.length, 0);
  assert.equal(vm.systemViewsError, null);
});

test("changing system tables ignores stale successes and failures", async () => {
  for (const fail of [false, true]) {
    const vm = new ViewModel();
    vm.tables = tables;
    vm.setSelectedSystemTable("account");
    let complete;
    const result = new Promise((resolve, reject) => { complete = fail ? reject : resolve; });
    const stale = vm.loadSystemViews({ getSystemViews: () => result });
    vm.setSelectedSystemTable("contact");
    await vm.loadSystemViews({ getSystemViews: async () => [] });
    complete(fail ? new Error("Stale failure") : [systemView]);
    await stale;
    assert.equal(vm.selectedSystemTableLogicalName, "contact");
    assert.equal(vm.systemViews.length, 0);
    assert.equal(vm.systemViewsError, null);
    assert.equal(vm.isLoadingSystemViews, false);
  }
});

test("system view errors are reported and can be retried", async () => {
  const vm = new ViewModel();
  vm.tables = tables;
  vm.setSelectedSystemTable("account");
  await assert.rejects(vm.loadSystemViews({
    getSystemViews: async () => { throw new Error("Read denied"); },
  }), /Read denied/);
  assert.equal(vm.systemViewsError, "Read denied");
  assert.equal(vm.isLoadingSystemViews, false);
  await vm.loadSystemViews({ getSystemViews: async () => [systemView] });
  assert.equal(vm.systemViewsError, null);
  assert.deepEqual(vm.systemViews, [systemView]);
});

test("connection resets and unmount invalidate system view requests and table selection", async () => {
  for (const reset of ["connection", "unmount"]) {
    const vm = new ViewModel();
    vm.tables = tables;
    vm.setActiveTab("system");
    vm.setSelectedSystemTable("account");
    const wait = deferred();
    const loading = vm.loadSystemViews({ getSystemViews: () => wait.promise });
    if (reset === "connection") await vm.loadUsers({ getActiveUsers: async () => [] });
    else vm.resetSystemViews();
    wait.resolve([systemView]);
    await loading;
    assert.equal(vm.selectedSystemTableLogicalName, null);
    assert.equal(vm.systemViews.length, 0);
    assert.equal(vm.isLoadingSystemViews, false);
    assert.equal(vm.systemViewsError, null);
    assert.equal(vm.activeTab, "system");
  }
});

test("system views query savedquery by numeric table code and reuse cached table metadata", async () => {
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
          { LogicalName: "account", ObjectTypeCode: 1, DisplayName: { LocalizedLabels: [{ Label: "Account" }] } },
          { LogicalName: "custom_table", ObjectTypeCode: 10550 },
        ] };
      },
      fetchXmlQuery: async (query) => {
        queries.push(query);
        return { value: [{ savedqueryid: systemView.id, name: systemView.name, modifiedon: systemView.modifiedOn, description: systemView.description }] };
      },
    },
  });
  await service.getTables();
  assert.deepEqual(await service.getSystemViews("account"), [systemView]);
  const custom = await service.getSystemViews("custom_table");
  assert.equal(custom[0].entityName, "custom_table");
  assert.equal(custom[0].tableName, "custom_table (custom_table)");
  assert.equal(metadataCalls, 1);
  assert.match(queries[0], /<entity name="savedquery">/);
  assert.match(queries[0], /<attribute name="savedqueryid"/);
  assert.match(queries[0], /attribute="returnedtypecode" operator="eq" value="1"/);
  assert.match(queries[1], /attribute="returnedtypecode" operator="eq" value="10550"/);
  assert.match(queries[0], /<order attribute="name"/);
  assert.doesNotMatch(queries[0], /ownerid|userquery|principalobjectaccess/);
});

test("invalid system tables and missing numeric codes do not submit view queries", async () => {
  const logs = [];
  let metadataCalls = 0;
  const service = new dvService({
    connection: null,
    onLog: (...entry) => logs.push(entry),
    dvApi: {
      getAllEntitiesMetadata: async () => {
        metadataCalls++;
        return { value: [{ LogicalName: "account", ObjectTypeCode: null }] };
      },
      fetchXmlQuery: async () => assert.fail("Invalid table must not query views"),
    },
  });
  for (const value of [null, undefined, "", 'account" />']) {
    await assert.rejects(service.getSystemViews(value), /valid Dataverse table/);
  }
  assert.equal(metadataCalls, 0);
  await assert.rejects(service.getSystemViews("account"), /valid ObjectTypeCode/);
  await assert.rejects(service.getSystemViews("unknown"), /valid ObjectTypeCode/);
  assert.equal(logs.length, 6);
  assert.ok(logs.every(([, level]) => level === "error"));
});

test("system view query and response errors retain diagnostic logs", async () => {
  const logs = [];
  let rows = [{}];
  const service = new dvService({
    connection: null,
    onLog: (...entry) => logs.push(entry),
    dvApi: {
      getAllEntitiesMetadata: async () => ({ value: [{ LogicalName: "account", ObjectTypeCode: 1 }] }),
      fetchXmlQuery: async () => ({ value: rows }),
    },
  });
  await assert.rejects(service.getSystemViews("account"), /without an ID or name/);
  rows = [];
  assert.deepEqual(await service.getSystemViews("account"), []);
  service.dvApi.fetchXmlQuery = async () => { throw new Error("Saved-query read denied"); };
  await assert.rejects(service.getSystemViews("account"), /Saved-query read denied/);
  assert.equal(logs.length, 2);
  assert.ok(logs.every(([message, level]) =>
    level === "error" && message.includes("system views") && message.includes('entity name="savedquery"')));
});
