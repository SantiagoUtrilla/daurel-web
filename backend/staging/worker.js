import { demoPageResponse } from "./demo-page.js";
import {operatorPageResponse} from "./operator-page.js";
import {operatorActionCatalog,operatorRecordAction} from "./operator-actions.js";
import {operatorQueue,operatorUpdateStatus,operatorSendInvitation} from "./operator-api.js";
import { adminPageResponse } from "./admin-page.js";
import { dossierPageResponse } from "./dossier-page.js";
import { mailTestPageResponse } from "./email-test-page.js";
import { sendStagingDeliveryProbe } from "./email-test-api.js";
import { authPilotPageResponse } from "./auth-pilot-page.js";
import { accountLinkPageResponse } from "./account-link-page.js";
import {invitationPageResponse} from "./invitation-page.js";
import {clientPortalPageResponse} from "./client-portal-page.js";
import {
 portalRequestLogin,portalVerifyLogin,portalSession,portalLogout,
 portalMatters,portalAcceptInvitation,
} from "./client-portal-api.js";
import {issuePilotInvite,redeemPilotInvite,viewPilotInvitedMatters} from "./invitation-api.js";
import {viewPilotAccount, linkPilotClient, unlinkPilotClient} from "./account-link-api.js";
import {
  startPilotLogin,verifyPilotLogin,getPilotSession,logoutPilotSession
} from "./auth-pilot-api.js";
import { getDemoDossier, recordDemoAction } from "./dossier-api.js";
// DAUREL V2 - Worker de staging. Solo pruebas, nunca tráfico de clientes.
import {
  authorizeDemo, createDemoRequest, listDemoClientRequests, getDemoAdminOverview, json,
} from "./demo-api.js";

const OPTIONAL_INVITATION_TABLES = [
  "case_invitations", "account_request_access", "case_access_audit",
];

const OPTIONAL_ACCOUNT_TABLES = [
  "accounts", "account_emails", "account_party_access",
  "login_challenges", "account_sessions", "auth_rate_limits",
  "account_access_audit",
];

const REQUIRED_TABLES = [
  "parties", "persons", "organizations", "party_contacts", "channel_accounts",
  "external_identities", "professions", "services", "service_professions",
  "service_requests", "request_participants", "conversations",
  "conversation_participants", "conversation_request_links",
  "integration_events", "request_events", "consents", "legacy_request_map",
];

async function health(env) {
  try {
    const connectivity = await env.DB.prepare("SELECT 1 AS ok").first();
    if (connectivity?.ok !== 1) throw new Error("D1 connectivity check failed");
    const { results = [] } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).all();
    const present = new Set(results.map((row) => row.name));
    const missingTables = REQUIRED_TABLES.filter((table) => !present.has(table));
    const missingAccountTables = OPTIONAL_ACCOUNT_TABLES.filter((table) => !present.has(table));
    const missingInvitationTables = OPTIONAL_INVITATION_TABLES.filter((table) => !present.has(table));
    return json({
      service: "DAUREL V2 staging",
      status: missingTables.length ? "schema_incomplete" : "online",
      database: "connected",
      schema: {
        version: "0001_v2_core.sql",
        ready: missingTables.length === 0,
        expected_tables: REQUIRED_TABLES.length,
        found_tables: REQUIRED_TABLES.length - missingTables.length,
        missing_tables: missingTables,
      },
      optional_account_schema: {
        ready: missingAccountTables.length === 0,
        expected_tables: OPTIONAL_ACCOUNT_TABLES.length,
        found_tables: OPTIONAL_ACCOUNT_TABLES.length - missingAccountTables.length,
        missing_tables: missingAccountTables,
      },
      optional_invitation_schema: {
        ready: missingInvitationTables.length === 0,
        expected_tables: OPTIONAL_INVITATION_TABLES.length,
        found_tables: OPTIONAL_INVITATION_TABLES.length - missingInvitationTables.length,
        missing_tables: missingInvitationTables,
      },
    }, missingTables.length ? 503 : 200);
  } catch {
    console.error("DAUREL staging healthcheck failed");
    return json({ service: "DAUREL V2 staging", status: "unavailable" }, 503);
  }
}

export default {
  async fetch(request, env) {
    // Bloqueo independiente de dominio: nunca operar con otra configuración.
    if (env.ENVIRONMENT !== "staging") {
      return json({ success: false, message: "Forbidden" }, 403);
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return health(env);
    }

    // Ruta del cliente simulado: sin STAGING_TEST_TOKEN. Solo correo fijo,
    // cookie de sesión y permisos individuales. Aislado por ENVIRONMENT staging.
    if(request.method==="GET" && url.pathname==="/v2/client"){
      return clientPortalPageResponse();
    }
    const clientApi={
      "/v2/client/api/start":["POST",portalRequestLogin],
      "/v2/client/api/verify":["POST",portalVerifyLogin],
      "/v2/client/api/session":["GET",portalSession],
      "/v2/client/api/logout":["POST",portalLogout],
      "/v2/client/api/cases":["GET",portalMatters],
      "/v2/client/api/accept":["POST",portalAcceptInvitation],
    };
    const clientRoute=clientApi[url.pathname];
    if(clientRoute){
      if(request.method!==clientRoute[0]){
        return json({success:false,message:"Método no permitido."},405);
      }
      try{return await clientRoute[1](request,env)}
      catch{
        console.error("DAUREL staging client portal error");
        return json({success:false,message:"Acceso temporalmente no disponible."},503);
      }
    }

    if (request.method === "GET" && url.pathname === "/v2/demo") {
      return demoPageResponse();
    }

    if(request.method==="GET" && url.pathname==="/v2/operator"){
      return operatorPageResponse();
    }

    if (request.method === "GET" && url.pathname === "/v2/demo/admin") {
      return adminPageResponse();
    }

    if (request.method === "GET" && url.pathname === "/v2/demo/dossier") {
      return dossierPageResponse();
    }

    if (request.method === "GET" && url.pathname === "/v2/demo/mail") {
      return mailTestPageResponse();
    }

    if(request.method === "GET" && url.pathname === "/v2/demo/auth") {
      return authPilotPageResponse();
    }
    if(request.method==="GET" && url.pathname==="/v2/demo/account"){
      return accountLinkPageResponse();
    }
    if(request.method==="GET" && url.pathname==="/v2/demo/invitations"){
      return invitationPageResponse();
    }
    const isOperatorActions=request.method==="GET" && url.pathname==="/v2/operator/api/actions";
    const isOperatorRecord=request.method==="POST" && url.pathname==="/v2/operator/api/record";
    const isOperatorQueue=request.method==="GET" && url.pathname==="/v2/operator/api/queue";
    const isOperatorStatus=request.method==="POST" && url.pathname==="/v2/operator/api/status";
    const isOperatorInvite=request.method==="POST" && url.pathname==="/v2/operator/api/invite";
    const isInviteIssue=request.method==="POST" && url.pathname==="/v2/demo/invitations/issue";
    const isInviteRedeem=request.method==="POST" && url.pathname==="/v2/demo/invitations/redeem";
    const isInviteView=request.method==="GET" && url.pathname==="/v2/demo/invitations/my-cases";
    const isAccountView=request.method==="GET" && url.pathname==="/v2/demo/account/data";
    const isAccountLink=request.method==="POST" && url.pathname==="/v2/demo/account/link";
    const isAccountUnlink=request.method==="POST" && url.pathname==="/v2/demo/account/unlink";
    const isPilotStart = request.method === "POST" && url.pathname === "/v2/demo/auth/start";
    const isPilotVerify = request.method === "POST" && url.pathname === "/v2/demo/auth/verify";
    const isPilotSession = request.method === "GET" && url.pathname === "/v2/demo/auth/session";
    const isPilotLogout = request.method === "POST" && url.pathname === "/v2/demo/auth/logout";
    const isMailTest = request.method === "POST" && url.pathname === "/v2/demo/mail/test";
    const dossierMatch = request.method === "GET"
      ? /^\/v2\/demo\/dossiers\/(demo-[a-z0-9_-]{1,32})$/.exec(url.pathname)
      : null;
    const actionMatch = request.method === "POST"
      ? /^\/v2\/demo\/requests\/([0-9a-f-]{36})\/events$/i.exec(url.pathname)
      : null;
    const isAdminOverview = request.method === "GET" && url.pathname === "/v2/demo/admin/data";
    const isDemoCreate = request.method === "POST" && url.pathname === "/v2/demo/requests";
    const clientMatch = request.method === "GET"
      ? /^\/v2\/demo\/clients\/([^/]+)$/.exec(url.pathname)
      : null;

    if (!isDemoCreate && !clientMatch && !isAdminOverview && !dossierMatch && !actionMatch && !isMailTest && !isPilotStart && !isPilotVerify && !isPilotSession && !isPilotLogout && !isAccountView && !isAccountLink && !isAccountUnlink && !isInviteIssue && !isInviteRedeem && !isInviteView && !isOperatorQueue && !isOperatorStatus && !isOperatorInvite && !isOperatorActions && !isOperatorRecord) {
      return json({ success: false, message: "Ruta no disponible en staging." }, 404);
    }

    const auth = await authorizeDemo(request, env.STAGING_TEST_TOKEN);
    if (auth === "not_configured") {
      return json({ success: false, message: "API de pruebas deshabilitada: falta configurar Secret." }, 503);
    }
    if (auth !== "authorized") {
      return json({ success: false, message: "Acceso no autorizado." }, 401);
    }

    try {
      if(isOperatorActions)return operatorActionCatalog();
      if(isOperatorRecord)return await operatorRecordAction(request,env);
      if(isOperatorQueue)return await operatorQueue(env);
      if(isOperatorStatus)return await operatorUpdateStatus(request,env);
      if(isOperatorInvite)return await operatorSendInvitation(request,env);
      if(isInviteIssue)return await issuePilotInvite(request,env);
      if(isInviteRedeem)return await redeemPilotInvite(request,env);
      if(isInviteView)return await viewPilotInvitedMatters(request,env);
      if(isAccountView)return await viewPilotAccount(request,env);
      if(isAccountLink)return await linkPilotClient(request,env);
      if(isAccountUnlink)return await unlinkPilotClient(request,env);
      if (isPilotStart) return await startPilotLogin(request,env);
      if (isPilotVerify) return await verifyPilotLogin(request,env);
      if (isPilotSession) return await getPilotSession(request,env);
      if (isPilotLogout) return await logoutPilotSession(request,env);
      if (isMailTest) return await sendStagingDeliveryProbe(request, env);
      if (dossierMatch) return await getDemoDossier(env, dossierMatch[1]);
      if (actionMatch) return await recordDemoAction(request, env, actionMatch[1]);
      if (isDemoCreate) return await createDemoRequest(request, env);
      if (isAdminOverview) return await getDemoAdminOverview(env);
      return await listDemoClientRequests(decodeURIComponent(clientMatch[1]), env);
    } catch {
      console.error("DAUREL staging demo API error");
      return json({ success: false, message: "Error interno de prueba; no reintentes con una clave de idempotencia diferente." }, 500);
    }
  },
};
