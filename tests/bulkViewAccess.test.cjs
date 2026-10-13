const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dvService,
  viewId,
  user,
  newUser,
  anotherUser,
  view,
  secondView,
  createBulkAccessModel,
  deferred,
} = require("./helpers.cjs");

test("direct user sharing lookup targets one view/user pair without the sharing-grid limit", async () => {
  const queries = [];
  let rows = [];
  const service = new dvService({
    connection: null,
    onLog: () => {},
    dvApi: { fetchXmlQuery: async (query) => { queries.push(query); return { value: rows }; } },
  });
  assert.equal(await service.getUserViewAccessMask(viewId, newUser.id), 0);
  rows = [{ accessrightsmask: 0 }];
  assert.equal(await service.getUserViewAccessMask(viewId, newUser.id), 0);
  rows = [{ accessrightsmask: 55 }];
  assert.equal(await service.getUserViewAccessMask(viewId, newUser.id), 55);
  for (const query of queries) {
    assert.match(query, /<fetch top="1">/);
    assert.match(query, new RegExp(`attribute="objectid" operator="eq" value="${viewId}"`));
    assert.match(query, new RegExp(`attribute="principalid" operator="eq" value="${newUser.id}"`));
    assert.match(query, /attribute="objecttypecode" operator="eq" value="4230"/);
    assert.match(query, /attribute="principaltypecode" operator="eq" value="8"/);
    assert.doesNotMatch(query, /top="51"|inheritedaccessrightsmask/);
  }
});

test("direct sharing lookup rejects invalid IDs, malformed masks and API errors with logs", async () => {
  const logs = [];
  let calls = 0;
  let mask;
  const service = new dvService({
    connection: null,
    onLog: (...entry) => logs.push(entry),
    dvApi: { fetchXmlQuery: async () => { calls++; return { value: [{ accessrightsmask: mask }] }; } },
  });
  await assert.rejects(service.getUserViewAccessMask("invalid", newUser.id), /ID is invalid/);
  await assert.rejects(service.getUserViewAccessMask(viewId, "invalid"), /ID is invalid/);
  assert.equal(calls, 0);
  for (const invalid of [undefined, null, "1", -1, 1.5, NaN, Infinity]) {
    mask = invalid;
    await assert.rejects(service.getUserViewAccessMask(viewId, newUser.id), /invalid direct sharing access mask/);
  }
  assert.equal(logs.length, 9);
  assert.ok(logs.every(([message, level]) => level === "error" && message.includes("FetchXML:")));
  service.dvApi.fetchXmlQuery = async () => { throw new Error("Read denied"); };
  await assert.rejects(service.getUserViewAccessMask(viewId, newUser.id), /Read denied/);
  assert.match(logs.at(-1)[0], /user view access.*Read denied/);
});

test("Add users starts with no writes and locks selection, refresh, owner changes and other access edits", async () => {
  const vm = createBulkAccessModel();
  vm.selectedViews = [];
  assert.throws(() => vm.beginAddUsersToViews(), /Select one or more views/);
  vm.selectedViews = [view];
  vm.stageViewAccess(user, 3);
  assert.throws(() => vm.beginAddUsersToViews(), /discard existing changes/);
  vm.discardAccessChanges();
  vm.beginAddUsersToViews();
  assert.equal(vm.bulkAccessViews.length, 1);
  assert.equal(vm.bulkAccessMask, 1);
  assert.equal(vm.bulkAccessTotal, 0);
  assert.equal(vm.pendingBulkAccess.length, 0);
  assert.equal(vm.accessNavigationLocked, true);
  assert.equal(vm.canChangeViewOwners, false);
  await vm.selectViews({}, []);
  await vm.loadPersonalViews({}, user.id);
  vm.setSelectedOwner(null);
  assert.equal(vm.selectedOwnerId, user.id);
  assert.equal(vm.selectedViews.length, 1);
  assert.throws(() => vm.beginChangeViewOwner(), /Finish the current operation/);
  vm.cancelBulkAccess();
  assert.equal(vm.bulkAccessViews.length, 0);
  assert.equal(vm.selectedViews.length, 1);
  assert.equal(vm.selectedView.id, viewId);
  assert.equal(vm.accessNavigationLocked, false);
});

test("bulk access validates users and permissions before submitting any work", async () => {
  const vm = createBulkAccessModel();
  await assert.rejects(vm.saveBulkViewAccess({}, [newUser.id], 1), /open Add users/);
  vm.beginAddUsersToViews();
  for (const ids of [[], ["missing"], [newUser.id, "missing"]]) {
    await assert.rejects(vm.saveBulkViewAccess({}, ids, 1), /available users/);
  }
  for (const mask of [0, -1, 1.5, NaN, 8, 4, 16, 32, 2 ** 32]) {
    await assert.rejects(vm.saveBulkViewAccess({}, [newUser.id], mask), /supported permission/);
  }
  assert.equal(vm.bulkAccessTotal, 0);
  assert.equal(vm.pendingBulkAccess.length, 0);
  assert.equal(vm.isSavingBulkAccess, false);
});

test("bulk access grants new shares and replaces existing masks exactly for every selected user/view pair", async () => {
  const vm = createBulkAccessModel();
  vm.beginAddUsersToViews();
  const requests = [];
  const reads = [];
  let metadataCalls = 0;
  const service = new dvService({
    connection: null,
    onLog: () => {},
    dvApi: {
      fetchXmlQuery: async (query) => {
        if (query.includes('name="userquery"')) {
          assert.equal(requests.length, 4);
          assert.match(query, new RegExp(`attribute="ownerid" operator="eq" value="${user.id}"`));
          return { value: [] };
        }
        reads.push(query);
        return { value: query.includes(newUser.id) ? [] : [{ accessrightsmask: 55 }] };
      },
      execute: async (request) => { requests.push(request); return {}; },
      getAllEntitiesMetadata: async () => { metadataCalls++; return { value: [] }; },
    },
  });
  assert.equal(await vm.saveBulkViewAccess(service, [newUser.id, anotherUser.id, newUser.id.toUpperCase()], 1), true);
  assert.equal(reads.length, 4);
  assert.equal(metadataCalls, 1);
  assert.deepEqual(requests.map((request) => [
    request.operationName,
    request.parameters.Target.userqueryid,
    request.parameters.PrincipalAccess.Principal.systemuserid,
    request.parameters.PrincipalAccess.AccessMask,
  ]), [
    ["GrantAccess", viewId, newUser.id, "ReadAccess"],
    ["ModifyAccess", viewId, anotherUser.id, "ReadAccess"],
    ["GrantAccess", secondView.id, newUser.id, "ReadAccess"],
    ["ModifyAccess", secondView.id, anotherUser.id, "ReadAccess"],
  ]);
  assert.equal(vm.bulkAccessViews.length, 0);
  assert.equal(vm.pendingBulkAccess.length, 0);
  assert.equal(vm.selectedViews.length, 0);
  assert.equal(vm.selectedView, null);
  assert.equal(vm.isSavingBulkAccess, false);
  assert.equal(vm.accessNavigationLocked, false);
});

test("bulk access partial failures retain pending pairs and retry only unfinished changes", async () => {
  const vm = createBulkAccessModel();
  vm.beginAddUsersToViews();
  const calls = [];
  let fail = true;
  let refreshed = 0;
  const service = {
    getUserViewAccessMask: async () => 0,
    grantViewAccess: async (id, principal, mask) => {
      calls.push([id, principal.id, mask]);
      if (principal.id === anotherUser.id && fail) throw new Error("Share denied");
    },
    getPersonalViews: async () => { refreshed++; return [view, secondView]; },
  };
  await assert.rejects(vm.saveBulkViewAccess(service, [newUser.id, anotherUser.id], 3),
    /Another user on "Test view".*Share denied.*1 of 4 user\/view changes completed; 3 remain/);
  assert.equal(refreshed, 0);
  assert.equal(vm.pendingBulkAccess.length, 3);
  assert.equal(vm.isSavingBulkAccess, false);
  assert.equal(vm.bulkAccessViews.length, 2);
  assert.equal(vm.selectedViews.length, 0);
  await assert.rejects(vm.saveBulkViewAccess(service, [newUser.id], 3), /same users and permissions/);
  await assert.rejects(vm.saveBulkViewAccess(service, [newUser.id, anotherUser.id], 1), /same users and permissions/);
  fail = false;
  assert.equal(await vm.saveBulkViewAccess(service, [anotherUser.id, newUser.id], 3), true);
  assert.equal(refreshed, 1);
  assert.deepEqual(calls, [
    [viewId, newUser.id, 3], [viewId, anotherUser.id, 3], [viewId, anotherUser.id, 3],
    [secondView.id, newUser.id, 3], [secondView.id, anotherUser.id, 3],
  ]);
});

test("failed bulk access reads never default to granting and partial changes can be closed without rollback", async () => {
  const vm = createBulkAccessModel([view]);
  vm.beginAddUsersToViews();
  let reads = 0;
  let writes = 0;
  await assert.rejects(vm.saveBulkViewAccess({
    getUserViewAccessMask: async () => {
      if (++reads === 2) throw new Error("Sharing lookup denied");
      return 0;
    },
    grantViewAccess: async () => { writes++; },
  }, [newUser.id, anotherUser.id], 1), /Sharing lookup denied.*1 of 2/);
  assert.equal(writes, 1);
  vm.cancelBulkAccess();
  assert.equal(vm.bulkAccessViews.length, 0);
  assert.equal(vm.pendingBulkAccess.length, 0);
  assert.equal(vm.accessNavigationLocked, false);
  assert.equal(vm.selectedView, null);
});

test("bulk access prevents duplicate submissions and cancellation while saving", async () => {
  const vm = createBulkAccessModel([view]);
  vm.beginAddUsersToViews();
  const wait = deferred();
  const saving = vm.saveBulkViewAccess({
    getUserViewAccessMask: () => wait.promise,
    grantViewAccess: async () => {},
    getPersonalViews: async () => [view],
  }, [newUser.id], 1);
  assert.equal(await vm.saveBulkViewAccess({}, [newUser.id], 1), false);
  vm.cancelBulkAccess();
  assert.equal(vm.bulkAccessViews.length, 1);
  assert.equal(vm.isSavingBulkAccess, true);
  wait.resolve(0);
  assert.equal(await saving, true);
});

test("bulk access reload failures report saved changes without offering another write", async () => {
  const vm = createBulkAccessModel([view]);
  vm.beginAddUsersToViews();
  await assert.rejects(vm.saveBulkViewAccess({
    getUserViewAccessMask: async () => 3,
    updateViewAccess: async () => {},
    getPersonalViews: async () => { throw new Error("Read denied"); },
  }, [newUser.id], 1), /Access was saved, but reloading views failed.*Read denied/);
  assert.equal(vm.bulkAccessViews.length, 0);
  assert.equal(vm.pendingBulkAccess.length, 0);
  assert.equal(vm.accessNavigationLocked, false);
  assert.match(vm.personalViewsError, /Access was saved/);
});

test("connection changes and unmount stop bulk access between lookup/write and before remaining pairs", async () => {
  for (const phase of ["lookup", "write", "reload"]) {
    for (const reset of ["connection", "unmount"]) {
      const vm = createBulkAccessModel();
      vm.beginAddUsersToViews();
      const wait = deferred();
      const started = deferred();
      let writes = 0;
      const saving = vm.saveBulkViewAccess({
        getUserViewAccessMask: async () => {
          if (phase === "lookup") { started.resolve(); return wait.promise; }
          return 0;
        },
        grantViewAccess: async () => {
          writes++;
          if (phase === "write") { started.resolve(); await wait.promise; }
        },
        getPersonalViews: async () => {
          if (phase !== "reload") assert.fail("Stale batch must not reload");
          started.resolve();
          return wait.promise;
        },
      }, [newUser.id, anotherUser.id], 1);
      await started.promise;
      if (reset === "connection") await vm.loadUsers({ getActiveUsers: async () => [] });
      else vm.resetBulkAccess();
      vm.personalViews = [];
      wait.resolve(phase === "reload" ? [view] : 0);
      assert.equal(await saving, false);
      assert.equal(writes, phase === "lookup" ? 0 : phase === "write" ? 1 : 4);
      assert.equal(vm.personalViews.length, 0);
      assert.equal(vm.isSavingBulkAccess, false);
      assert.equal(vm.bulkAccessViews.length, 0);
    }
  }
});
