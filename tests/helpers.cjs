const { readFileSync } = require("node:fs");
const path = require("node:path");
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

const { ViewModel, accessRights, formatAccessRights, selectableAccessRights, getAccessMaskFromSelection } = loadSource(path.join("src", "model", "viewModel.tsx"));
const { dvService } = loadSource(path.join("src", "services", "dataverseService.tsx"));
const viewId = "33bc5942-dbee-ef11-be20-6045bded7daf";
const user = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Example user", principalType: "User", accessRightsMask: 1 };
const team = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Example team", principalType: "Team", accessRightsMask: 1 };
const newUser = { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "New user", isCurrentUser: false };
const anotherUser = { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", name: "Another user", isCurrentUser: false };
const view = { id: viewId, name: "Test view", entityName: "account", tableName: "Account (account)", ownerId: user.id, ownerName: user.name, modifiedOn: "", description: "" };
const secondView = { ...view, id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", name: "Second view" };
const thirdView = { ...view, id: "ffffffff-ffff-ffff-ffff-ffffffffffff", name: "Third view" };
const systemView = {
  id: "77777777-7777-7777-7777-777777777777",
  name: "System view",
  entityName: "account",
  tableName: "Account (account)",
  modifiedOn: "",
  description: "Account system view",
};

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

function createBulkAccessModel(views = [view, secondView]) {
  const vm = createModel();
  vm.personalViews = views;
  vm.selectedViews = views;
  vm.activeUsers = [newUser, anotherUser];
  vm.selectedOwnerId = user.id;
  return vm;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const unmanagedSolution = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "View customizations",
  uniqueName: "ViewCustomizations",
  version: "1.0.0.0",
};
const viewDefinition = {
  name: view.name,
  returnedtypecode: "account",
  fetchxml: '<fetch><entity name="account"><attribute name="name" /></entity></fetch>',
  layoutxml: '<grid name="resultset" object="1"><row name="result" id="accountid"><cell name="name" width="300" /></row></grid>',
  description: "Account view",
};

function createCopyService(overrides = {}) {
  return {
    getUnmanagedSolutions: async () => [unmanagedSolution],
    systemViewExists: async () => false,
    getPersonalViewDefinition: async () => ({ ...viewDefinition }),
    createSystemView: async () => {},
    addSystemViewToSolution: async () => {},
    ...overrides,
  };
}

function createCopyModel(views = [view, secondView]) {
  const vm = createBulkAccessModel(views);
  vm.beginCopySystemViews();
  return vm;
}

function createPersonalCopyService(overrides = {}) {
  return {
    personalViewExists: async () => false,
    getSystemViewDefinition: async () => ({ ...viewDefinition }),
    createPersonalView: async () => {},
    ...overrides,
  };
}

function createPersonalCopyModel(sources = [systemView], owner = newUser) {
  const vm = new ViewModel();
  vm.activeTab = "system";
  vm.systemViews = sources;
  vm.selectedSystemViews = sources;
  vm.beginCopySystemViewToPersonal();
  vm.copySystemViewToPersonal.selectOwner(owner.id, [newUser, anotherUser]);
  return vm;
}

module.exports = {
  ViewModel,
  accessRights,
  formatAccessRights,
  selectableAccessRights,
  getAccessMaskFromSelection,
  dvService,
  viewId,
  user,
  team,
  newUser,
  anotherUser,
  view,
  secondView,
  thirdView,
  systemView,
  createService,
  createModel,
  createBulkAccessModel,
  deferred,
  unmanagedSolution,
  viewDefinition,
  createCopyService,
  createCopyModel,
  createPersonalCopyService,
  createPersonalCopyModel,
};
