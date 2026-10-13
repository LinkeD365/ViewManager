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

test("Dataverse services preserve numeric destination slots through slot 9", async () => {
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
  for (let slot = 1; slot < 10; slot++) {
    const service = new dvService({
      connection: null,
      dvApi,
      onLog: () => {},
      connectionTarget: slot,
    });
    assert.deepEqual(await service.getActiveUsers(), [{ ...newUser, isCurrentUser: true }]);
  }
  assert.deepEqual(targetsSeen, Array.from({ length: 9 }, (_, index) => index + 1).flatMap((slot) => [slot, slot]));
});
