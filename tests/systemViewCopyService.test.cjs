const assert = require("node:assert/strict");
const test = require("node:test");
const { createService, dvService, viewId, user, unmanagedSolution, viewDefinition } = require("./helpers.cjs");

const solutionRecord = {
  solutionid: unmanagedSolution.id,
  friendlyname: unmanagedSolution.name,
  uniquename: unmanagedSolution.uniqueName,
  version: unmanagedSolution.version,
  ismanaged: false,
  isvisible: true,
};

test("solution picker queries only visible unmanaged solutions and excludes internal solutions", async () => {
  const { service } = createService();
  service.dvApi.fetchXmlQuery = async (xml) => {
    assert.match(xml, /<entity name="solution">/);
    assert.match(xml, /attribute="ismanaged" operator="eq" value="0"/);
    assert.match(xml, /attribute="isvisible" operator="eq" value="1"/);
    assert.match(xml, /<order attribute="friendlyname"/);
    assert.match(xml, /attribute="uniquename" operator="not-in"/);
    return { value: [
      solutionRecord,
      { ...solutionRecord, ismanaged: true },
      { ...solutionRecord, isvisible: false },
      { ...solutionRecord, uniquename: "Default" },
      { ...solutionRecord, uniquename: "Active" },
    ] };
  };
  assert.deepEqual(await service.getUnmanagedSolutions(), [unmanagedSolution]);
  service.dvApi.fetchXmlQuery = async () => ({ value: [] });
  assert.deepEqual(await service.getUnmanagedSolutions(), []);
});

test("malformed solution results and query failures are logged and rejected", async () => {
  const { service, logs } = createService();
  for (const bad of [
    { ismanaged: undefined }, { isvisible: "true" }, { solutionid: "invalid" },
    { friendlyname: "" }, { uniquename: null }, { version: 1 },
  ]) {
    service.dvApi.fetchXmlQuery = async () => ({ value: [{ ...solutionRecord, ...bad }] });
    await assert.rejects(service.getUnmanagedSolutions());
  }
  service.dvApi.fetchXmlQuery = async () => { throw new Error("Read solution denied"); };
  await assert.rejects(service.getUnmanagedSolutions(), /Read solution denied/);
  assert.equal(logs.length, 7);
  assert.ok(logs.every(([message, level]) => level === "error"
    && message.includes("unmanaged solutions") && !message.includes("FetchXML")));
});

test("writes are refused if the captured connection no longer matches its slot", async () => {
  let writes = 0;
  const connection = { id: "connection-1", url: "https://example.crm.dynamics.com" };
  const service = new dvService({
    connection,
    connectionTarget: 0,
    validateConnection: async () => false,
    onLog: () => {},
    dvApi: {
      create: async () => { writes++; },
      execute: async () => { writes++; },
    },
  });
  await assert.rejects(service.createPersonalView(viewId, viewDefinition, user.id), /environment changed/);
  await assert.rejects(service.addSystemViewToSolution(viewId, unmanagedSolution.uniqueName), /environment changed/);
  assert.equal(writes, 0);
});

test("personal definition copies supported layout fields without ownership or personal IDs", async () => {
  const { service } = createService();
  const definition = {
    ...viewDefinition, columnsetxml: "<columns />", layoutjson: '{"rows":[]}',
    conditionalformatting: "{}", advancedgroupby: "name",
  };
  service.dvApi.retrieve = async (entity, id, columns) => {
    assert.equal(entity, "userquery");
    assert.equal(id, viewId);
    assert.deepEqual(columns, [
      "name", "returnedtypecode", "fetchxml", "layoutxml",
      "description", "columnsetxml", "layoutjson", "conditionalformatting", "advancedgroupby",
    ]);
    return { ...definition, userqueryid: viewId, ownerid: unmanagedSolution.id, querytype: 16, isdefault: true };
  };
  assert.deepEqual(await service.getPersonalViewDefinition(viewId), definition);
});

test("numeric personal view type codes resolve to logical names for system view creation", async () => {
  const { service } = createService();
  let metadataCalls = 0;
  service.dvApi.getAllEntitiesMetadata = async (properties) => {
    metadataCalls++;
    assert.deepEqual(properties, ["LogicalName", "DisplayName", "ObjectTypeCode"]);
    return { value: [{ LogicalName: "account", ObjectTypeCode: 1 }] };
  };
  for (const returnedtypecode of [1, "1"]) {
    service.dvApi.retrieve = async () => ({ ...viewDefinition, returnedtypecode, description: null });
    const result = await service.getPersonalViewDefinition(viewId);
    assert.equal(result.returnedtypecode, "account");
    assert.equal(result.description, undefined);
  }
  assert.equal(metadataCalls, 1);
});

test("missing or malformed personal definitions fail before creating a view", async () => {
  const { service, logs } = createService();
  service.dvApi.getAllEntitiesMetadata = async () => ({ value: [] });
  service.dvApi.create = async () => assert.fail("Invalid source must not create a view");
  for (const bad of [
    { name: "" }, { fetchxml: null }, { layoutxml: " " }, { returnedtypecode: undefined },
    { returnedtypecode: '<account>' }, { returnedtypecode: 1 }, { returnedtypecode: -1 },
    { returnedtypecode: 1.5 }, { layoutjson: {} },
  ]) {
    service.dvApi.retrieve = async () => ({ ...viewDefinition, ...bad });
    await assert.rejects(service.getPersonalViewDefinition(viewId));
  }
  assert.equal(logs.length, 9);
  assert.ok(logs.every(([message, level]) => level === "error" && message.includes("personal view definition")));
});

test("system copy uses the supplied stable GUID and is a non-default public view", async () => {
  const { service } = createService(() => assert.fail("Creating a copy must not publish"));
  const calls = [];
  service.dvApi.create = async (...args) => { calls.push(args); return { id: viewId }; };
  await service.createSystemView(viewId, viewDefinition);
  assert.deepEqual(calls, [["savedquery", {
    ...viewDefinition, savedqueryid: viewId, querytype: 0, isdefault: false,
  }]]);
});

test("solution addition uses AddSolutionComponent with saved-query component type 26", async () => {
  const calls = [];
  const { service } = createService(async (request) => { calls.push(request); return {}; });
  await service.addSystemViewToSolution(viewId, unmanagedSolution.uniqueName);
  assert.deepEqual(calls, [{
    operationName: "AddSolutionComponent",
    operationType: "action",
    parameters: {
      ComponentId: viewId, ComponentType: 26, SolutionUniqueName: unmanagedSolution.uniqueName,
      AddRequiredComponents: false, DoNotIncludeSubcomponents: true,
    },
  }]);
});

test("copy existence checks only its stable ID and reject unexpected records", async () => {
  const { service, logs } = createService();
  service.dvApi.fetchXmlQuery = async (xml) => {
    assert.match(xml, /<fetch top="1"><entity name="savedquery">/);
    assert.ok(xml.includes(`attribute="savedqueryid" operator="eq" value="${viewId}"`));
    return { value: [] };
  };
  assert.equal(await service.systemViewExists(viewId), false);
  service.dvApi.fetchXmlQuery = async () => ({ value: [{ savedqueryid: viewId.toUpperCase() }] });
  assert.equal(await service.systemViewExists(viewId), true);
  service.dvApi.fetchXmlQuery = async () => ({ value: [{ savedqueryid: unmanagedSolution.id }] });
  await assert.rejects(service.systemViewExists(viewId), /unexpected system view/);
  assert.equal(logs.length, 1);
});

test("invalid copy IDs, definitions and solution choices do not reach Dataverse", async () => {
  const { service, logs } = createService(() => assert.fail("Invalid input must not execute"));
  service.dvApi.fetchXmlQuery = service.dvApi.retrieve = service.dvApi.create =
    async () => assert.fail("Invalid input must not reach Dataverse");
  await assert.rejects(service.getPersonalViewDefinition("bad"), /record ID is invalid/);
  await assert.rejects(service.systemViewExists('"><bad />'), /record ID is invalid/);
  await assert.rejects(service.createSystemView("bad", viewDefinition), /record ID is invalid/);
  await assert.rejects(service.addSystemViewToSolution("bad", "solution"), /record ID is invalid/);
  await assert.rejects(service.addSystemViewToSolution(viewId, ""), /Select an unmanaged solution/);
  for (const bad of [{ name: "" }, { layoutxml: null }, { returnedtypecode: "1" }]) {
    await assert.rejects(service.createSystemView(viewId, { ...viewDefinition, ...bad }));
  }
  assert.equal(logs.length, 8);
});

test("copy read, create and add failures retain original technical errors in logs", async () => {
  const { service, logs } = createService();
  const failure = new Error("Insufficient customization privileges");
  const fail = async () => { throw failure; };
  service.dvApi.retrieve = service.dvApi.fetchXmlQuery = service.dvApi.create = service.dvApi.execute = fail;
  for (const operation of [
    () => service.getPersonalViewDefinition(viewId), () => service.systemViewExists(viewId),
    () => service.createSystemView(viewId, viewDefinition),
    () => service.addSystemViewToSolution(viewId, unmanagedSolution.uniqueName),
  ]) {
    await assert.rejects(operation(), (error) => error === failure);
  }
  assert.equal(logs.length, 4);
  assert.ok(logs.every(([message, level]) => level === "error" && message.includes(failure.message)));
});
