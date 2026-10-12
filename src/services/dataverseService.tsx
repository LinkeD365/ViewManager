import type { ActiveUser, dvServiceProps, PersonalView, ViewAccess, ViewDataService } from "../model/viewModel";
import { accessRights, isEditableAccessMask } from "../model/viewModel";

export class dvService implements ViewDataService {
  connection: ToolBoxAPI.DataverseConnection | null;
  dvApi: DataverseAPI.API;
  onLog: (message: string, type?: "info" | "success" | "warning" | "error") => void;
  batchSize = 2;
  private entityDisplayNames: Promise<Map<string, string>> | null = null;
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

  async getPersonalViews(ownerId: string | null): Promise<PersonalView[]> {
    if (ownerId !== null && !/^[0-9a-f-]{36}$/i.test(ownerId)) {
      throw new Error("The selected owner ID is not a valid Dataverse ID.");
    }

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
      ] : []),
      '    <order attribute="modifiedon" descending="true" />',
      '  </entity>',
      '</fetch>',
    ].join("");
    const [result, entityDisplayNames] = await Promise.all([
      this.callDataverse("fetchXmlQuery (personal views)", () => this.dvApi.fetchXmlQuery(fetchXml), fetchXml),
      this.getEntityDisplayNames(),
    ]);

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
          ? `${entityDisplayNames.get(entityName) || entityName} (${entityName})`
          : "",
        ownerId: typeof record.ownerid === "string" ? record.ownerid : "",
        ownerName: typeof record["owner.fullname"] === "string" ? record["owner.fullname"] : "",
        modifiedOn: typeof record.modifiedon === "string" ? record.modifiedon : "",
        description: typeof record.description === "string" ? record.description : "",
      };
    });
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

  private getEntityDisplayNames(): Promise<Map<string, string>> {
    if (!this.entityDisplayNames) {
      this.entityDisplayNames = this.callDataverse("getAllEntitiesMetadata (table names)", () =>
        this.dvApi.getAllEntitiesMetadata(["LogicalName", "DisplayName"]))
        .then((metadata) => new Map(
          metadata.value.map((entity) => [
            entity.LogicalName,
            entity.DisplayName?.LocalizedLabels[0]?.Label || entity.LogicalName,
          ]),
        ))
        .catch((error: unknown) => {
          // Allow a later request to retry after a failed metadata load.
          this.entityDisplayNames = null;
          throw error;
        });
    }
    return this.entityDisplayNames;
  }
}
