const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ViewModel, dvService, newUser, anotherUser, view, systemView, viewDefinition,
} = require("./helpers.cjs");

const targets = [1, 3].map((slot) => ({
  slot,
  name: `Environment ${slot + 1}`,
  environment: `org${slot + 1}.crm.dynamics.com`,
}));

test("cross-environment copy supports no more than six destinations plus the primary", () => {
  const operation = new ViewModel().crossEnvironmentCopy;
  const sixDestinations = Array.from({ length: 6 }, (_, index) => ({
    slot: index + 1,
    name: `Environment ${index + 2}`,
    environment: `org${index + 2}.crm.dynamics.com`,
  }));
  operation.beginPersonal([view], sixDestinations);
  operation.cancel();
  assert.throws(
    () => operation.beginPersonal([view], [...sixDestinations, {
      slot: 7,
      name: "Environment 8",
      environment: "org8.crm.dynamics.com",
    }]),
    /up to seven environments/,
  );
});

test("personal views copy to selected destinations with destination-specific owners", async () => {
  const operation = new ViewModel().crossEnvironmentCopy;
  const source = { ...view, id: "source-view" };
  const calls = [];
  const sourceService = {
    getPersonalViewDefinition: async (id) => {
      calls.push(["read-source", id]);
      return { ...viewDefinition };
    },
  };
  const destinationServices = new Map([
    [1, {
      getActiveUsers: async () => [newUser],
      personalViewExists: async (id) => { calls.push(["exists", 1, id]); return false; },
      createPersonalView: async (id, definition, ownerId) => {
        calls.push(["create", 1, id, ownerId]);
        assert.deepEqual(definition, viewDefinition);
      },
    }],
    [3, {
      getActiveUsers: async () => [anotherUser],
      personalViewExists: async (id) => { calls.push(["exists", 3, id]); return false; },
      createPersonalView: async (id, definition, ownerId) => {
        calls.push(["create", 3, id, ownerId]);
        assert.deepEqual(definition, viewDefinition);
      },
    }],
  ]);

  operation.beginPersonal([source], targets);
  await operation.selectTargets([1, 3], destinationServices);
  operation.selectOwner(1, newUser.id);
  operation.selectOwner(3, anotherUser.id);
  const ids = operation.personalCopies.map((copy) => copy.targetViewId);
  assert.equal(new Set(ids).size, 2);
  assert.equal(await operation.copy(sourceService, destinationServices), true);
  assert.deepEqual(calls, [
    ["exists", 1, ids[0]], ["read-source", source.id], ["create", 1, ids[0], newUser.id],
    ["exists", 3, ids[1]], ["read-source", source.id], ["create", 3, ids[1], anotherUser.id],
  ]);
});

test("system copies retain IDs and destination settings when retrying a partial batch", async () => {
  const operation = new ViewModel().crossEnvironmentCopy;
  const calls = [];
  let failSolutionAdd = true;
  const sourceService = {
    getSystemViewDefinition: async (id) => {
      calls.push(["read-source", id]);
      return { ...viewDefinition };
    },
  };
  const makeDestination = (slot) => ({
    getUnmanagedSolutions: async () => [{
      id: `solution-${slot}`,
      name: `Solution ${slot}`,
      uniqueName: `Solution${slot}`,
      version: "1.0.0.0",
    }],
    systemViewExists: async (id) => { calls.push(["exists", slot, id]); return false; },
    createSystemView: async (id) => { calls.push(["create", slot, id]); },
    addSystemViewToSolution: async (id, solution) => {
      calls.push(["add", slot, id, solution]);
      if (slot === 3 && failSolutionAdd) throw new Error("Solution addition failed");
    },
  });
  const destinationServices = new Map([[1, makeDestination(1)], [3, makeDestination(3)]]);

  operation.beginSystem([systemView], targets);
  await operation.selectTargets([1, 3], destinationServices);
  operation.selectSolution(1, "Solution1");
  operation.selectSolution(3, "Solution3");
  const ids = operation.systemCopies.map((copy) => copy.targetViewId);
  await assert.rejects(operation.copy(sourceService, destinationServices), /Solution addition failed/);
  assert.equal(operation.systemCopies[0].added, true);
  assert.equal(operation.systemCopies[1].created, true);
  assert.equal(operation.systemCopies[1].added, false);
  await assert.rejects(operation.selectTargets([1], destinationServices), /cannot change/);
  assert.throws(() => operation.selectSolution(3, "Solution1"), /same destination solution/);

  failSolutionAdd = false;
  assert.equal(await operation.copy(sourceService, destinationServices), true);
  assert.deepEqual(calls.slice(-1), [["add", 3, ids[1], "Solution3"]]);
});

test("missing destination table error explains how to resolve the failed copy", async () => {
  const operation = new ViewModel().crossEnvironmentCopy;
  const missingTableError = "Error invoking remote method 'dataverse.create': Error: Dataverse create failed: "
    + "0x80041102: The entity with a name = 'contoso_listing' with namemapping = 'Logical' was not found "
    + "in the MetadataCache.LazyDynamicMetadataCache with version 6941766 and timestamp 6941766";
  const sourceService = { getPersonalViewDefinition: async () => ({ ...viewDefinition }) };
  const destinationService = {
    getActiveUsers: async () => [newUser],
    personalViewExists: async () => false,
    createPersonalView: async () => { throw new Error(missingTableError); },
  };
  const services = new Map([[1, destinationService]]);

  operation.beginPersonal([view], targets.slice(0, 1));
  await operation.selectTargets([1], services);
  operation.selectOwner(1, newUser.id);
  await assert.rejects(operation.copy(sourceService, services), /table required by this view/);
  assert.match(operation.error, /0 of 1 view copy completed/);
  assert.match(operation.error, /contoso_listing/);
  assert.match(operation.error, /installed and published in the destination environment/);
  assert.doesNotMatch(operation.error, /80041102|MetadataCache|6941766|remote method/);
});

test("Dataverse services preserve numeric destination slots through slot 6", async () => {
  const targetsSeen = [];
  const dvApi = {
    fetchXmlQuery: async (_fetchXml, target) => {
      targetsSeen.push(target);
      return { value: [{ systemuserid: newUser.id, fullname: newUser.name }] };
    },
    execute: async (_request, target) => {
      targetsSeen.push(target);
      return { UserId: newUser.id };
    },
  };
  for (let slot = 1; slot < 7; slot++) {
    const service = new dvService({
      connection: null,
      dvApi,
      onLog: () => {},
      connectionTarget: slot,
    });
    assert.deepEqual(await service.getActiveUsers(), [{ ...newUser, isCurrentUser: true }]);
  }
  assert.deepEqual(targetsSeen, Array.from({ length: 6 }, (_, index) => index + 1).flatMap((slot) => [slot, slot]));
});
