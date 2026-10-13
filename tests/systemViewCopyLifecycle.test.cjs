const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createCopyModel, createCopyService, unmanagedSolution, viewDefinition, view, deferred,
} = require("./helpers.cjs");

test("an active copy cannot be submitted twice or cancelled", async () => {
  const copy = createCopyModel([view]).copySystemViews;
  const wait = deferred();
  const started = deferred();
  let creates = 0;
  const service = createCopyService({
    systemViewExists: async () => { started.resolve(); return wait.promise; },
    createSystemView: async () => { creates++; },
  });
  await copy.loadSolutions(service);
  const saving = copy.copy(service, unmanagedSolution.uniqueName);
  await started.promise;
  assert.equal(copy.isCopying, true);
  assert.equal(await copy.copy(service, unmanagedSolution.uniqueName), false);
  copy.cancel();
  assert.equal(copy.isOpen, true);
  wait.resolve(false);
  assert.equal(await saving, true);
  assert.equal(creates, 1);
});

test("cancelled solution loads cannot overwrite a newly opened form or surface stale errors", async () => {
  for (const fail of [false, true]) {
    const vm = createCopyModel([view]);
    const copy = vm.copySystemViews;
    const wait = deferred();
    const old = copy.loadSolutions(createCopyService({
      getUnmanagedSolutions: async () => {
        await wait.promise;
        if (fail) throw new Error("Stale solution failure");
        return [];
      },
    }));
    copy.cancel();
    vm.beginCopySystemViews();
    await copy.loadSolutions(createCopyService());
    wait.resolve();
    await old;
    assert.deepEqual(copy.solutions, [unmanagedSolution]);
    assert.equal(copy.solutionsError, null);
    assert.equal(copy.isLoadingSolutions, false);
  }
});

for (const stage of [
  "getUnmanagedSolutions", "systemViewExists", "getPersonalViewDefinition",
  "createSystemView", "addSystemViewToSolution",
]) {
  test(`connection changes and unmount during ${stage} stop further copy requests`, async () => {
    for (const reset of ["connection", "unmount"]) {
      for (const fail of [false, true]) {
        const vm = createCopyModel();
        const copy = vm.copySystemViews;
        const service = createCopyService();
        await copy.loadSolutions(service);
        const wait = deferred();
        const started = deferred();
        const calls = [];
        for (const [name, operation] of Object.entries(service)) {
          service[name] = async (...args) => {
            calls.push(name);
            if (name === stage) {
              started.resolve();
              await wait.promise;
              if (fail) throw new Error("Stale Dataverse failure");
            }
            return operation(...args);
          };
        }
        const saving = copy.copy(service, unmanagedSolution.uniqueName);
        await started.promise;
        const submitted = calls.length;
        if (reset === "connection") await vm.loadUsers({ getActiveUsers: async () => [] });
        else copy.reset();
        wait.resolve();
        assert.equal(await saving, false);
        assert.equal(calls.length, submitted, "No reads or writes may start after the reset");
        assert.equal(copy.isOpen, false);
        assert.equal(copy.isCopying, false);
        assert.equal(copy.error, null);
        assert.equal(copy.lockedSolution, null);
        assert.deepEqual(copy.solutions, []);
      }
    }
  });
}

test("source read and existence failures stop the batch and leave it retryable", async () => {
  for (const stage of ["systemViewExists", "getPersonalViewDefinition"]) {
    const copy = createCopyModel([view]).copySystemViews;
    let creates = 0;
    const service = createCopyService({
      createSystemView: async () => { creates++; },
      [stage]: async () => { throw new Error("Read denied"); },
    });
    await copy.loadSolutions(service);
    await assert.rejects(copy.copy(service, unmanagedSolution.uniqueName), /Read denied/);
    assert.equal(creates, 0);
    assert.equal(copy.isCopying, false);
    assert.equal(copy.copies[0].created, false);
    service[stage] = async () => stage === "systemViewExists" ? false : viewDefinition;
    assert.equal(await copy.copy(service, unmanagedSolution.uniqueName), true);
    assert.equal(creates, 1);
  }
});
