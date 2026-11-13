import { demoPageResponse } from "./demo-page.js";
import {operatorPageResponse} from "./operator-page.js";
import {operatorAuditLog} from "./operator-audit.js";
import {revokeClientAccess} from "./client-access-revoke.js";
import {
 caseAccessSchemaReady,assignedCase,listCaseAssignments,changeCaseAssignment,
} from "./operator-case-access.js";
import {listOperatorTeam,addOperatorMember,changeOperatorMember} from "./operator-team.js";
import {
 operatorSchemaReady,operatorEnrolled,operatorIdentity,operatorStatus,
 operatorStart,operatorVerify,operatorLogout,roleAllows,auditOperatorOperation,
} from "./operator-auth.js";
import {operatorCreate,operatorHistory} from "./operator-extras.js";
import {listFollowups,createFollowup,changeFollowup} from "./followup-api.js";
import {previewDailyAlerts,sendDailyAlerts} from "./daily-alerts.js";
import {telegramConnectionStatus,testTelegramConnection,discoverTelegramChat} from "./telegram-setup.js";
import {operatorActionCatalog,operatorRecordAction} from "./operator-actions.js";
import {operatorQueue,operatorUpdateStatus,operatorSendInvitation} from "./operator-api.js";
import {listProfessionalProfiles,saveProfessionalProfile} from "./operator-professionals.js";
import {listProfessionalIdentities,saveProfessionalIdentity} from "./operator-professional-identity.js";
import {operatorRoutingOverview} from "./operator-routing.js";
import { adminPageResponse } from "./admin-page.js";
import { dossierPageResponse } from "./dossier-page.js";
import { mailTestPageResponse } from "./email-test-page.js";
import { sendStagingDeliveryProbe } from "./email-test-api.js";
import { authPilotPageResponse } from "./auth-pilot-page.js";
import { accountLinkPageResponse } from "./account-link-page.js";
import {invitationPageResponse} from "./invitation-page.js";
import {clientPortalPageResponse} from "./client-portal-page.js";
import {createClientSelfRequest} from "./client-self-intake.js";
import {clientCaseProgress} from "./client-progress-api.js";
import {ownerNextStepView,ownerNextStepSave} from "./client-next-step.js";
import {guestPageResponse} from "./guest-page.js";
import {clientEmailPilotPage} from "./client-email-pilot-page.js";
import {startClientEmailPilot,verifyClientEmailPilot} from "./client-email-pilot.js";
import {submitGuestRequest} from "./guest-intake.js";
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

const OPTIONAL_TEAM_TABLES=["operator_approved_emails","operator_case_assignments"];
const OPTIONAL_OPERATOR_TABLES=[
  "operator_memberships","operator_login_challenges","operator_sessions","operator_access_audit",
];
const OPTIONAL_FOLLOWUP_TABLES = ["followup_tasks"];

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
    const missingFollowupTables = OPTIONAL_FOLLOWUP_TABLES.filter((table) => !present.has(table));
    const missingOperatorTables = OPTIONAL_OPERATOR_TABLES.filter(table=>!present.has(table));
    const missingTeamTables=OPTIONAL_TEAM_TABLES.filter(table=>!present.has(table));
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
      optional_followup_schema: {
        ready: missingFollowupTables.length === 0,
        expected_tables: OPTIONAL_FOLLOWUP_TABLES.length,
        found_tables: OPTIONAL_FOLLOWUP_TABLES.length - missingFollowupTables.length,
        missing_tables: missingFollowupTables,
      },
      optional_operator_schema:{
        ready:missingOperatorTables.length===0,
        expected_tables:OPTIONAL_OPERATOR_TABLES.length,
        missing_tables:missingOperatorTables,
      },
      optional_team_schema:{
        ready:missingTeamTables.length===0,
        expected_tables:OPTIONAL_TEAM_TABLES.length,
        missing_tables:missingTeamTables,
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
    if(request.method==="GET" && url.pathname==="/v2/guest"){
      return guestPageResponse(env);
    }
    if(request.method==="GET" && url.pathname==="/v2/client/email-test"){
      return clientEmailPilotPage(env);
    }
    const clientApi={
      "/v2/client/api/start":["POST",portalRequestLogin],
      "/v2/client/api/verify":["POST",portalVerifyLogin],
      "/v2/client/api/session":["GET",portalSession],
      "/v2/client/api/logout":["POST",portalLogout],
      "/v2/client/api/cases":["GET",portalMatters],
      "/v2/client/api/progress":["GET",clientCaseProgress],
      "/v2/client/api/accept":["POST",portalAcceptInvitation],
      "/v2/client/api/create":["POST",createClientSelfRequest],
      "/v2/client/api/email/start":["POST",startClientEmailPilot],
      "/v2/client/api/email/verify":["POST",verifyClientEmailPilot],
      "/v2/guest/api/create":["POST",submitGuestRequest],
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

    // La sesión administrativa nunca equivale a una sesión de cliente.
    const authPaths={
      "/v2/operator/auth/status":["GET",operatorStatus],
      "/v2/operator/auth/setup/start":["POST",operatorStart],
      "/v2/operator/auth/start":["POST",operatorStart],
      "/v2/operator/auth/verify":["POST",operatorVerify],
      "/v2/operator/auth/logout":["POST",operatorLogout],
    };
    const adminAuth=authPaths[url.pathname];
    if(adminAuth){
      if(request.method!==adminAuth[0])return json({success:false,message:"Método no permitido."},405);
      try{return await adminAuth[1](request,env)}
      catch{return json({success:false,message:"Acceso administrativo no disponible."},503)}
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
    const isTelegramStatus=request.method==="GET" && url.pathname==="/v2/operator/api/telegram/status";
    const isTelegramTest=request.method==="POST" && url.pathname==="/v2/operator/api/telegram/test";
    const isTelegramDiscover=request.method==="POST" && url.pathname==="/v2/operator/api/telegram/discover";
    const isAlertPreview=request.method==="GET" && url.pathname==="/v2/operator/api/alerts/preview";
    const isFollowupList=request.method==="GET" && url.pathname==="/v2/operator/api/followups";
    const isFollowupCreate=request.method==="POST" && url.pathname==="/v2/operator/api/followups/create";
    const isFollowupComplete=request.method==="POST" && url.pathname==="/v2/operator/api/followups/complete";
    const isFollowupCancel=request.method==="POST" && url.pathname==="/v2/operator/api/followups/cancel";
    const isOperatorActions=request.method==="GET" && url.pathname==="/v2/operator/api/actions";
    const isOperatorRecord=request.method==="POST" && url.pathname==="/v2/operator/api/record";
    const isOperatorCreate=request.method==="POST" && url.pathname==="/v2/operator/api/create";
    const operatorHistoryMatch=request.method==="GET"
      ? /^\/v2\/operator\/api\/history\/([0-9a-f-]{36})$/i.exec(url.pathname)
      : null;
    const isAssignmentsList=request.method==="GET" && url.pathname==="/v2/operator/api/assignments/list";
    const isAssignmentsChange=request.method==="POST" && url.pathname==="/v2/operator/api/assignments/change";
    const isOperatorTeamList=request.method==="GET" && url.pathname==="/v2/operator/api/team/list";
    const isOperatorTeamAdd=request.method==="POST" && url.pathname==="/v2/operator/api/team/add";
    const isOperatorTeamChange=request.method==="POST" && url.pathname==="/v2/operator/api/team/change";
    const isClientAccessRevoke=request.method==="POST" && url.pathname==="/v2/operator/api/client-access/revoke";
    const isOperatorAudit=request.method==="GET" && url.pathname==="/v2/operator/api/audit";
    const isOperatorQueue=request.method==="GET" && url.pathname==="/v2/operator/api/queue";
    const isOperatorRouting=request.method==="GET" && url.pathname==="/v2/operator/api/routing";
    const isNextStepView=request.method==="GET" && url.pathname==="/v2/operator/api/client-next-step";
    const isNextStepSave=request.method==="POST" && url.pathname==="/v2/operator/api/client-next-step";
    const isProfessionalList=request.method==="GET" && url.pathname==="/v2/operator/api/professionals/list";
    const isProfessionalSave=request.method==="POST" && url.pathname==="/v2/operator/api/professionals/save";
    const isProfessionalIdentityList=request.method==="GET" && url.pathname==="/v2/operator/api/professionals/identity/list";
    const isProfessionalIdentitySave=request.method==="POST" && url.pathname==="/v2/operator/api/professionals/identity/save";
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

    if (!isDemoCreate && !clientMatch && !isAdminOverview && !dossierMatch && !actionMatch && !isMailTest && !isPilotStart && !isPilotVerify && !isPilotSession && !isPilotLogout && !isAccountView && !isAccountLink && !isAccountUnlink && !isInviteIssue && !isInviteRedeem && !isInviteView && !isOperatorQueue && !isOperatorRouting && !isNextStepView && !isNextStepSave && !isProfessionalList && !isProfessionalSave && !isProfessionalIdentityList && !isProfessionalIdentitySave && !isOperatorStatus && !isOperatorInvite && !isOperatorActions && !isOperatorRecord && !isFollowupList && !isFollowupCreate && !isFollowupComplete && !isFollowupCancel && !isAlertPreview && !isTelegramStatus && !isTelegramTest && !isTelegramDiscover && !isOperatorCreate && !operatorHistoryMatch && !isOperatorAudit && !isOperatorTeamList && !isOperatorTeamAdd && !isOperatorTeamChange && !isAssignmentsList && !isAssignmentsChange && !isClientAccessRevoke) {
      return json({ success: false, message: "Ruta no disponible en staging." }, 404);
    }

    const isOperatorApi=url.pathname.startsWith("/v2/operator/api/");
    let operatorActor=null;
    // Hasta la primera activación sigue disponible el laboratorio antiguo.
    // Una vez concedido un rol, no se puede usar la clave técnica para operar.
    const operatorReady=isOperatorApi&&await operatorSchemaReady(env);
    const enrolled=operatorReady&&await operatorEnrolled(env);
    if(isOperatorApi&&enrolled){
      operatorActor=await operatorIdentity(request,env);
      if(!operatorActor)return json({success:false,message:"Inicia sesión como administrador."},401);
      if(!roleAllows(operatorActor.role,url.pathname,request.method))
        return json({success:false,message:"Tu rol no permite esta operación."},403);
      if(request.method==="POST"&&request.headers.get("Origin")!==url.origin)
        return json({success:false,message:"Origen no permitido."},403);
    }else{
      const auth=await authorizeDemo(request,env.STAGING_TEST_TOKEN);
      if(auth==="not_configured")
        return json({success:false,message:"API de pruebas deshabilitada: falta configurar Secret."},503);
      if(auth!=="authorized")
        return json({success:false,message:"Acceso no autorizado."},401);
    }

    // Un colaborador solo puede acceder a los asuntos asignados por el owner.
    // Esta comprobación se realiza ANTES de que ninguna ruta lea o escriba D1.
    if(operatorActor&&operatorActor.role!=="owner"){
      if(!await caseAccessSchemaReady(env))
        return json({success:false,message:"La autorización por expediente no está instalada."},503);
      let targetId=null;
      if(operatorHistoryMatch)targetId=operatorHistoryMatch[1];
      else if(isOperatorStatus||isOperatorRecord||isFollowupCreate||isFollowupComplete||isFollowupCancel){
        const raw=await request.clone().text();
        if(raw.length>1024)return json({success:false,message:"Solicitud demasiado grande."},413);
        let input;
        try{input=JSON.parse(raw)}catch{return json({success:false,message:"Solicitud inválida."},400)}
        if(isFollowupComplete||isFollowupCancel){
          if(typeof input?.task_id!=="string"||!/^followup-[0-9a-f]{64}$/.test(input.task_id))
            return json({success:false,message:"Pendiente inválido."},400);
          const item=await env.DB.prepare(
            "SELECT request_id FROM followup_tasks WHERE task_id=?"
          ).bind(input.task_id).first();
          targetId=item?.request_id||null;
        }else targetId=input?.request_id;
      }
      if(targetId&&!await assignedCase(env,operatorActor,targetId))
        return json({success:false,message:"Este expediente no está asignado a tu cuenta."},403);
    }

    try {
      const dispatch=async()=>{
      if(isTelegramStatus)return await telegramConnectionStatus(env);
      if(isTelegramTest)return await testTelegramConnection(request,env);
      if(isTelegramDiscover)return await discoverTelegramChat(request,env);
      if(isAlertPreview)return await previewDailyAlerts(env);
      if(isFollowupList)return await listFollowups(env,Date.now(),operatorActor);
      if(isFollowupCreate)return await createFollowup(request,env);
      if(isFollowupComplete)return await changeFollowup(request,env,"complete");
      if(isFollowupCancel)return await changeFollowup(request,env,"cancel");
      if(isOperatorActions)return operatorActionCatalog();
      if(isOperatorRecord)return await operatorRecordAction(request,env);
      if(isAssignmentsList)return await listCaseAssignments(env,operatorActor);
      if(isAssignmentsChange)return await changeCaseAssignment(request,env,operatorActor);
      if(isClientAccessRevoke)return await revokeClientAccess(request,env,operatorActor);
      if(isOperatorTeamList)return await listOperatorTeam(env,operatorActor);
      if(isOperatorTeamAdd)return await addOperatorMember(request,env,operatorActor);
      if(isOperatorTeamChange)return await changeOperatorMember(request,env,operatorActor);
      if(isOperatorAudit)return await operatorAuditLog(env,operatorActor,request);
      if(isOperatorQueue)return await operatorQueue(env,operatorActor);
      if(isOperatorRouting)return await operatorRoutingOverview(env,operatorActor,request);
      if(isNextStepView)return await ownerNextStepView(request,env,operatorActor);
      if(isNextStepSave)return await ownerNextStepSave(request,env,operatorActor);
      if(isProfessionalList)return await listProfessionalProfiles(env,operatorActor);
      if(isProfessionalSave)return await saveProfessionalProfile(request,env,operatorActor);
      if(isProfessionalIdentityList)return await listProfessionalIdentities(env,operatorActor);
      if(isProfessionalIdentitySave)return await saveProfessionalIdentity(request,env,operatorActor);
      if(isOperatorCreate)return await operatorCreate(request,env);
      if(operatorHistoryMatch)return await operatorHistory(env,operatorHistoryMatch[1]);
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
      };
      const outcome=await dispatch();
      if(operatorActor&&request.method==="POST"&&outcome.ok)
        await auditOperatorOperation(env,operatorActor,request.method,url.pathname);
      return outcome;
    } catch {
      console.error("DAUREL staging demo API error");
      return json({ success: false, message: "Error interno de prueba; no reintentes con una clave de idempotencia diferente." }, 500);
    }
  },
  async scheduled(controller,env,ctx){
    // Solo Cron diario de staging. Sin envío si no hay activación explícita.
    if(controller.cron!=="0 15 * * *"||env.ENVIRONMENT!=="staging")return;
    const result=await sendDailyAlerts(env,controller.scheduledTime);
    if(result.reason==="delivery_failed")throw new Error("No se confirmó la alerta del día de staging");
  },
};
