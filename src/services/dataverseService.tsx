import type { ActiveUser, dvServiceProps, PersonalView, SystemView, SystemViewDefinition, UnmanagedSolution, ViewAccess, ViewDataService, ViewTable } from "../model/viewModel";
import { accessRights, isEditableAccessMask } from "../model/viewModel";

const optionalViewDefinitionFields = [
  "description", "columnsetxml", "layoutjson", "conditionalformatting", "advancedgroupby",
] as const;

export class dvService implements ViewDataService {
  connection: ToolBoxAPI.DataverseConnection | null;
  dvApi: DataverseAPI.API;
  onLog: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  batchSize = 2;
  private entityMetadata: Promise<Map<string, DataverseAPI.EntityMetadata>> | null = null;
  constructor(props: dvServiceProps) {
    this.connection = props.connection;
    this.dvApi = props.dvApi;
    this.onLog = props.onLog;
  }

  async getActiveUsers(): Promise<ActiveUser[]> {
    const fetchXml = [
      '<fetch>',
      '  <entity name="systemuser">',
      '    <attribute name="fullname" />',
      '    <attribute name="systemuserid" />',
      '    <order attribute="fullname" />',
      '    <filter type="and">',
      '      <condition attribute="isdisabled" operator="eq" value="0" />',
      '      <condition attribute="accessmode" operator="ne" value="3" />',
      '      <condition attribute="accessmode" operator="ne" value="5" />',
      '      <condition attribute="applicationid" operator="null" />',
      '      <condition attribute="systemmanagedusertype" operator="eq" value="0" />',
      '    </filter>',
      '  </entity>',
      '</fetch>',
    ].join("");
    const [result, currentUser] = await Promise.all([
      this.callDataverse("fetchXmlQuery (active users)", () => this.dvApi.fetchXmlQuery(fetchXml), fetchXml),
      this.callDataverse("execute (WhoAmI)", () =>
        this.dvApi.execute({ operationName: "WhoAmI", operationType: "function" })),
    ]);
    const currentUserId = currentUser.UserId;
    if (typeof currentUserId !== "string") {
      throw new Error("Dataverse did not return the current user's ID.");
    }

    return result.value.map((record) => {
      const id = record.systemuserid;
      const name = record.fullname;
      if (typeof id !== "string" || typeof name !== "string") {
        throw new Error("Dataverse returned an active user without an ID or name.");
      }

      return { id, name, isCurrentUser: id.toLowerCase() === currentUserId.toLowerCase() };
    });
  }

  async getTables(): Promise<ViewTable[]> {
    const metadata = await this.getEntityMetadata();
    return Array.from(metadata, ([logicalName, entity]) => ({
      logicalName,
      name: `${entity.DisplayName?.LocalizedLabels[0]?.Label || logicalName} (${logicalName})`,
    })).sort((left, right) => left.name.localeCompare(right.name));
  }

  async getPersonalViews(ownerId: string | null, tableLogicalName: string | null = null): Promise<PersonalView[]> {
    if (ownerId !== null && !/^[0-9a-f-]{36}$/i.test(ownerId)) {
      throw new Error("The selected owner ID is not a valid Dataverse ID.");
    }
    if (ownerId === null && (!tableLogicalName || !/^[a-z][a-z0-9_]*$/i.test(tableLogicalName))) {
      throw new Error("Select a valid Dataverse table when viewing all owners.");
    }

    const entityMetadata = await this.getEntityMetadata();
    const objectTypeCode = ownerId === null ? this.getTableObjectTypeCode(entityMetadata, tableLogicalName) : null;

    const fetchXml = [
      '<fetch>',
      '  <entity name="userquery">',
      '    <attribute name="userqueryid" />',
      '    <attribute name="name" />',
      '    <attribute name="returnedtypecode" />',
      '    <attribute name="modifiedon" />',
      '    <attribute name="description" />',
      '    <attribute name="ownerid" />',
      '    <link-entity name="systemuser" from="systemuserid" to="ownerid" alias="owner" link-type="outer">',
      '      <attribute name="fullname" />',
      '    </link-entity>',
      ...(ownerId ? [
        '    <filter>',
        `      <condition attribute="ownerid" operator="eq" value="${ownerId}" />`,
        '    </filter>',
      ] : [
        '    <filter>',
        `      <condition attribute="returnedtypecode" operator="eq" value="${objectTypeCode}" />`,
        '    </filter>',
      ]),
      '    <order attribute="modifiedon" descending="true" />',
      '  </entity>',
      '</fetch>',
    ].join("");
    const result = await this.callDataverse(
      "fetchXmlQuery (personal views)", () => this.dvApi.fetchXmlQuery(fetchXml), fetchXml,
    );

    return result.value.map((record) => {
      const id = record.userqueryid;
      const name = record.name;
      if (typeof id !== "string" || typeof name !== "string") {
        throw new Error("Dataverse returned a personal view without an ID or name.");
      }

      const entityName = typeof record.returnedtypecode === "string" ? record.returnedtypecode : "";

      return {
        id,
        name,
        entityName,
        tableName: entityName
          ? `${entityMetadata.get(entityName)?.DisplayName?.LocalizedLabels[0]?.Label || entityName} (${entityName})`
          : "",
        ownerId: typeof record.ownerid === "string" ? record.ownerid : "",
        ownerName: typeof record["owner.fullname"] === "string" ? record["owner.fullname"] : "",
        modifiedOn: typeof record.modifiedon === "string" ? record.modifiedon : "",
        description: typeof record.description === "string" ? record.description : "",
      };
    });
  }

  async getSystemViews(tableLogicalName: string): Promise<SystemView[]> {
    if (!tableLogicalName || !/^[a-z][a-z0-9_]*$/i.test(tableLogicalName)) {
      const message = "Select a valid Dataverse table to load system views.";
      this.onLog(message, "error");
      throw new Error(message);
    }
    const metadata = await this.getEntityMetadata();
    const objectTypeCode = this.getTableObjectTypeCode(metadata, tableLogicalName);
    const fetchXml = [
      '<fetch>',
      '  <entity name="savedquery">',
      '    <attribute name="savedqueryid" />',
      '    <attribute name="name" />',
      '    <attribute name="modifiedon" />',
      '    <attribute name="description" />',
      '    <filter>',
      `      <condition attribute="returnedtypecode" operator="eq" value="${objectTypeCode}" />`,
      '    </filter>',
      '    <order attribute="name" />',
      '  </entity>',
      '</fetch>',
    ].join("");
    return this.callDataverse("fetchXmlQuery (system views)", async () => {
      const result = await this.dvApi.fetchXmlQuery(fetchXml);
      return result.value.map((record) => {
        if (typeof record.savedqueryid !== "string" || typeof record.name !== "string") {
          throw new Error("Dataverse returned a system view without an ID or name.");
        }
        return {
          id: record.savedqueryid,
          name: record.name,
          entityName: tableLogicalName,
          tableName: `${metadata.get(tableLogicalName)?.DisplayName?.LocalizedLabels[0]?.Label || tableLogicalName} (${tableLogicalName})`,
          modifiedOn: typeof record.modifiedon === "string" ? record.modifiedon : "",
          description: typeof record.description === "string" ? record.description : "",
        };
      });
    }, fetchXml);
  }

  async getUnmanagedSolutions(): Promise<UnmanagedSolution[]> {
    const fetchXml = [
      '<fetch>',
      '  <entity name="solution">',
      '    <attribute name="solutionid" />',
      '    <attribute name="friendlyname" />',
      '    <attribute name="uniquename" />',
      '    <attribute name="version" />',
      '    <attribute name="ismanaged" />',
      '    <attribute name="isvisible" />',
      '    <filter>',
      '      <condition attribute="ismanaged" operator="eq" value="0" />',
      '      <condition attribute="isvisible" operator="eq" value="1" />',
      '      <condition attribute="uniquename" operator="not-in"><value>Active</value><value>Default</value></condition>',
      '    </filter>',
      '    <order attribute="friendlyname" />',
      '  </entity>',
      '</fetch>',
    ].join("");
    return this.callDataverse("fetchXmlQuery (unmanaged solutions)", async () => {
      const result = await this.dvApi.fetchXmlQuery(fetchXml);
      const solutions: UnmanagedSolution[] = [];
      for (const record of result.value) {
        if (typeof record.ismanaged !== "boolean" || typeof record.isvisible !== "boolean") {
          throw new Error("Dataverse returned a solution without valid managed/visible flags.");
        }
        if (record.ismanaged || !record.isvisible) continue;
        const { solutionid, friendlyname, uniquename, version } = record;
        if (typeof solutionid !== "string" || typeof friendlyname !== "string" || !friendlyname.trim()
          || typeof uniquename !== "string" || !uniquename.trim() || typeof version !== "string") {
          throw new Error("Dataverse returned a solution without a valid ID, name, unique name or version.");
        }
        this.validateViewId(solutionid);
        if (["active", "default"].includes(uniquename.toLowerCase())) continue;
        solutions.push({ id: solutionid, name: friendlyname, uniqueName: uniquename, version });
      }
      return solutions;
    }, fetchXml);
  }

  async getPersonalViewDefinition(viewId: string): Promise<SystemViewDefinition> {
    return this.callDataverse(`retrieve (personal view definition: ${viewId})`, async () => {
      this.validateViewId(viewId);
      const record = await this.dvApi.retrieve("userquery", viewId, [
        "name", "returnedtypecode", "fetchxml", "layoutxml", ...optionalViewDefinitionFields,
      ]);
      const { name, fetchxml, layoutxml } = record;
      if (typeof name !== "string" || !name.trim() || typeof fetchxml !== "string" || !fetchxml.trim()
        || typeof layoutxml !== "string" || !layoutxml.trim()) {
        throw new Error("The personal view does not have a valid name, FetchXML and layout XML to copy.");
      }
      let logicalName = record.returnedtypecode;
      if (typeof logicalName !== "string" || !/^[a-z][a-z0-9_]*$/i.test(logicalName)) {
        const code = typeof logicalName === "number" ? logicalName
          : typeof logicalName === "string" && /^\d+$/.test(logicalName) ? Number(logicalName) : NaN;
        if (!Number.isSafeInteger(code) || code <= 0) throw new Error("The personal view has an invalid table type code.");
        const metadata = await this.getEntityMetadata();
        logicalName = Array.from(metadata.values()).find((entity) => entity.ObjectTypeCode === code)?.LogicalName;
      }
      if (typeof logicalName !== "string" || !/^[a-z][a-z0-9_]*$/i.test(logicalName)) {
        throw new Error("The personal view's table could not be resolved.");
      }
      const definition: SystemViewDefinition = { name, returnedtypecode: logicalName, fetchxml, layoutxml };
      for (const field of optionalViewDefinitionFields) {
        const value = record[field];
        if (value === null || value === undefined) continue;
        if (typeof value !== "string") throw new Error(`The personal view has an invalid ${field} value.`);
        definition[field] = value;
      }
      return definition;
    });
  }

  async systemViewExists(viewId: string): Promise<boolean> {
    const fetchXml = [
      '<fetch top="1"><entity name="savedquery"><attribute name="savedqueryid" /><filter>',
      `<condition attribute="savedqueryid" operator="eq" value="${viewId}" />`,
      '</filter></entity></fetch>',
    ].join("");
    return this.callDataverse(`fetchXmlQuery (system view copy: ${viewId})`, async () => {
      this.validateViewId(viewId);
      const result = await this.dvApi.fetchXmlQuery(fetchXml);
      if (result.value.length === 0) return false;
      const id = result.value[0].savedqueryid;
      if (typeof id !== "string" || id.toLowerCase() !== viewId.toLowerCase()) {
        throw new Error("Dataverse returned an unexpected system view while checking the copy.");
      }
      return true;
    }, fetchXml);
  }

  async createSystemView(viewId: string, definition: SystemViewDefinition): Promise<void> {
    await this.callDataverse(`create (system view: ${viewId})`, async () => {
      this.validateViewId(viewId);
      for (const field of ["name", "fetchxml", "layoutxml", "returnedtypecode"] as const) {
        if (typeof definition[field] !== "string" || !definition[field].trim()) {
          throw new Error(`The system view requires a valid ${field}.`);
        }
      }
      if (!/^[a-z][a-z0-9_]*$/i.test(definition.returnedtypecode)) {
        throw new Error("The system view requires a table logical name.");
      }
      await this.dvApi.create("savedquery", {
        ...definition,
        savedqueryid: viewId,
        querytype: 0,
        isdefault: false,
      });
    });
  }

  async addSystemViewToSolution(viewId: string, solutionUniqueName: string): Promise<void> {
    await this.callDataverse(`AddSolutionComponent (view: ${viewId}, solution: ${solutionUniqueName})`, async () => {
      this.validateViewId(viewId);
      if (!solutionUniqueName?.trim()) throw new Error("Select an unmanaged solution.");
      await this.dvApi.execute({
        operationName: "AddSolutionComponent",
        operationType: "action",
        parameters: {
          ComponentId: viewId,
          ComponentType: 26,
          SolutionUniqueName: solutionUniqueName,
          AddRequiredComponents: false,
          DoNotIncludeSubcomponents: true,
        },
      });
    });
  }

  private validateViewId(id: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("The Dataverse record ID is invalid.");
    }
  }

  async getViewAccess(viewId: string): Promise<ViewAccess[]> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(viewId)) {
      throw new Error("The selected view ID is not a valid Dataverse ID.");
    }

    const fetchXml = [
      '<fetch version="1.0" mapping="logical" distinct="true" latematerialize="true" top="51">',
      '  <entity name="principalobjectaccess">',
      '    <attribute name="accessrightsmask" />',
      '    <attribute name="principaltypecode" />',
      '    <attribute name="principalid" />',
      '    <filter type="or" hint="union">',
      ...[8, 9].map((principalType) => [
        '      <filter type="and">',
        `        <condition attribute="objectid" operator="eq" value="${viewId}" />`,
        '        <condition attribute="objecttypecode" operator="eq" value="4230" />',
        `        <condition attribute="principaltypecode" operator="eq" value="${principalType}" />`,
        '      </filter>',
      ].join("")),
      '    </filter>',
      '    <link-entity name="systemuser" link-type="outer" from="systemuserid" to="principalid" alias="systemuser">',
      '      <attribute name="fullname" />',
      '      <attribute name="systemuserid" />',
      '      <order attribute="fullname" />',
      '    </link-entity>',
      '    <link-entity name="team" link-type="outer" from="teamid" to="principalid" alias="team">',
      '      <attribute name="name" />',
      '      <attribute name="teamid" />',
      '      <attribute name="systemmanaged" />',
      '      <order attribute="name" />',
      '    </link-entity>',
      '  </entity>',
      '</fetch>',
    ].join("");
    const result = await this.callDataverse(`fetchXmlQuery (view access: ${viewId})`, () =>
      this.dvApi.fetchXmlQuery(fetchXml), fetchXml);
    return result.value.map((record) => {
      console.log(record);
      const id = record.principalid;
      const principalType = record.principaltypecode;
      const isUser = principalType === "systemuser" || principalType === 8;
      const isTeam = principalType === "team" || principalType === 9;
      const accessRightsMask = record.accessrightsmask;
      if (typeof id !== "string" || (!isUser && !isTeam)
        || typeof accessRightsMask !== "number" || !Number.isInteger(accessRightsMask)) {
        throw new Error("Dataverse returned an invalid view access record.");
      }
      const name = isUser ? record["systemuser.fullname"] : record["team.name"];
      return {
        id,
        name: typeof name === "string" && name ? name : id,
        principalType: isUser ? "User" : "Team",
        accessRightsMask,
      };
    });
  }

  async updateViewAccess(viewId: string, principal: ViewAccess, mask: number): Promise<void> {
    const operationName = mask === 0 ? "RevokeAccess" : "ModifyAccess";
    await this.writeViewAccess(viewId, principal, mask, operationName);
  }

  async getUserViewAccessMask(viewId: string, userId: string): Promise<number> {
    const fetchXml = [
      '<fetch top="1">',
      '  <entity name="principalobjectaccess">',
      '    <attribute name="accessrightsmask" />',
      '    <filter type="and">',
      `      <condition attribute="objectid" operator="eq" value="${viewId}" />`,
      '      <condition attribute="objecttypecode" operator="eq" value="4230" />',
      `      <condition attribute="principalid" operator="eq" value="${userId}" />`,
      '      <condition attribute="principaltypecode" operator="eq" value="8" />',
      '    </filter>',
      '  </entity>',
      '</fetch>',
    ].join("");
    return this.callDataverse(`fetchXmlQuery (user view access: ${viewId}, user: ${userId})`, async () => {
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!guid.test(viewId) || !guid.test(userId)) throw new Error("The view or user ID is invalid.");
      const result = await this.dvApi.fetchXmlQuery(fetchXml);
      if (result.value.length === 0) return 0;
      const mask = result.value[0].accessrightsmask;
      if (typeof mask !== "number" || !Number.isSafeInteger(mask) || mask < 0) {
        throw new Error("Dataverse returned an invalid direct sharing access mask.");
      }
      return mask;
    }, fetchXml);
  }

  async changeViewOwner(viewId: string, ownerId: string): Promise<void> {
    await this.callDataverse(`Assign (view: ${viewId}, owner: ${ownerId})`, async () => {
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!guid.test(viewId) || !guid.test(ownerId)) throw new Error("The view or owner ID is invalid.");
      await this.dvApi.execute({
        operationName: "Assign",
        operationType: "action",
        parameters: {
          Target: { "@odata.type": "Microsoft.Dynamics.CRM.userquery", userqueryid: viewId },
          Assignee: { "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: ownerId },
        },
      });
    });
  }

  async grantViewAccess(viewId: string, principal: ViewAccess, mask: number): Promise<void> {
    await this.writeViewAccess(viewId, principal, mask, "GrantAccess");
  }

  private async writeViewAccess(
    viewId: string,
    principal: ViewAccess,
    mask: number,
    operationName: "GrantAccess" | "ModifyAccess" | "RevokeAccess",
  ): Promise<void> {
    console.log(`Writing view access: ${operationName} (view: ${viewId}, ${principal.principalType}: ${principal.id})`);
    await this.callDataverse(`${operationName} (view: ${viewId}, ${principal.principalType}: ${principal.id})`, async () => {
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!guid.test(viewId) || !guid.test(principal.id)) throw new Error("The view or principal ID is invalid.");
      if (!isEditableAccessMask(mask)) throw new Error("The access rights mask is invalid or unsupported.");
      if (operationName === "GrantAccess" && mask === 0) throw new Error("Select at least one permission for a new share.");
      if (principal.principalType !== "User" && principal.principalType !== "Team") {
        throw new Error("Only users and teams can have their view access amended.");
      }
      const target = { "@odata.type": "Microsoft.Dynamics.CRM.userquery", userqueryid: viewId };
      const principalEntity = principal.principalType === "User"
        ? { "@odata.type": "Microsoft.Dynamics.CRM.systemuser", systemuserid: principal.id }
        : { "@odata.type": "Microsoft.Dynamics.CRM.team", teamid: principal.id };
      await this.dvApi.execute({
        operationName,
        operationType: "action",
        parameters: mask === 0
          ? { Target: target, Revokee: principalEntity }
          : {
            Target: target,
            PrincipalAccess: {
              Principal: principalEntity,
              AccessMask: accessRights.filter(([value]) => (mask & value) !== 0).map(([, , name]) => name).join(","),
            },
          },
      });
    });
  }

  private async callDataverse<T>(operation: string, request: () => Promise<T>, fetchXml?: string): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
          && typeof error.message === "string"
          ? error.message
          : String(error);
      this.onLog(`Dataverse ${operation} failed: ${message}${fetchXml ? `\nFetchXML: ${fetchXml}` : ""}`, "error");
      throw error;
    }
  }

  private getTableObjectTypeCode(metadata: Map<string, DataverseAPI.EntityMetadata>, logicalName: string | null): number {
    const code = metadata.get(logicalName ?? "")?.ObjectTypeCode;
    if (typeof code !== "number" || !Number.isSafeInteger(code) || code <= 0) {
      const message = `Dataverse did not return a valid ObjectTypeCode for table '${logicalName}'.`;
      this.onLog(message, "error");
      throw new Error(message);
    }
    return code;
  }

  private getEntityMetadata(): Promise<Map<string, DataverseAPI.EntityMetadata>> {
    if (!this.entityMetadata) {
      this.entityMetadata = this.callDataverse("getAllEntitiesMetadata (tables)", () =>
        this.dvApi.getAllEntitiesMetadata(["LogicalName", "DisplayName", "ObjectTypeCode"]))
        .then((metadata) => new Map(
          metadata.value.map((entity) => [
            entity.LogicalName,
            entity,
          ]),
        ))
        .catch((error: unknown) => {
          // Allow a later request to retry after a failed metadata load.
          this.entityMetadata = null;
          throw error;
        });
    }
    return this.entityMetadata;
  }
}
