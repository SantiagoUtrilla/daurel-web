// DAUREL - código recuperado del Worker legacy de producción el 2026-10-24.
// REFERENCIA HISTÓRICA: NO DESPLEGAR. Sin secrets incrustados en este archivo.
// PENDIENTE DE ENDURECIMIENTO: /telegram/setup carece de autenticación.
// Archivo normalizado desde el texto pegado; la compilación sintáctica se comprobó localmente.

const ALLOWED_ORIGINS = new Set([

  "https://daurel.com.mx",

  "https://www.daurel.com.mx",

]);

const ALLOWED_TURNSTILE_HOSTNAMES = new Set([

  "daurel.com.mx",

  "www.daurel.com.mx",

]);

const TELEGRAM_STATUS_LABELS = {

  contacted: "Contactada",

  in_attention: "En atención",

  closed: "Cerrada",

};

const ADMIN_ALLOWED_STATUSES = new Set([

  "new",

  "contacted",

  "in_attention",

  "closed",

]);

export default {

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    // ==========================================

    // TELEGRAM WEBHOOK

    // ==========================================

    if (

      request.method === "POST" &&

      url.pathname === "/telegram-webhook"

    ) {

      return handleTelegramWebhook(

        request,

        env,

        ctx

      );

    }

    // ==========================================

    // CONFIGURAR WEBHOOK TELEGRAM

    // ==========================================

    if (

      request.method === "GET" &&

      url.pathname === "/telegram/setup"

    ) {

      return setupTelegramWebhook(

        request,

        env

      );

    }

    const origin =

      request.headers.get("Origin");

    if (

      origin &&

      !ALLOWED_ORIGINS.has(origin)

    ) {

      return jsonResponse(

        {

          success: false,

          message:

            "Origen no autorizado.",

        },

        403,

        origin

      );

    }

    const corsHeaders = {

      "Access-Control-Allow-Origin":

        origin &&

        ALLOWED_ORIGINS.has(origin)

          ? origin

          : "https://daurel.com.mx",

      "Access-Control-Allow-Methods":

        "GET, POST, PATCH, OPTIONS",

      "Access-Control-Allow-Headers":

        "Content-Type, Authorization",

      "Vary":

        "Origin",

    };

    // ==========================================

    // CORS

    // ==========================================

    if (

      request.method === "OPTIONS"

    ) {

      return new Response(

        null,

        {

          status: 204,

          headers:

            corsHeaders,

        }

      );

    }

    // ==========================================

    // PANEL ADMIN - LISTAR SOLICITUDES

    // ==========================================

    if (

      request.method === "GET" &&

      url.pathname === "/admin/leads"

    ) {

      if (

        !isAdminAuthorized(

          request,

          env

        )

      ) {

        return Response.json(

          {

            success: false,

            message:

              "Acceso no autorizado.",

          },

          {

            status: 401,

            headers:

              corsHeaders,

          }

        );

      }

      try {

        const result =

          await env.DB.prepare(`

            SELECT

              request_id,

              persona,

              name,

              whatsapp,

              whatsapp_e164,

              email,

              location,

              situation,

              key_answer,

              category_front,

              category_internal,

              urgency,

              priority,

              status,

              follow_up_status,

              follow_up_count,

              professional_assigned,

              documents_status,

              created_at,

              updated_at

            FROM leads

            ORDER BY created_at DESC

            LIMIT 200

          `).all();

        return Response.json(

          {

            success: true,

            leads:

              result.results || [],

          },

          {

            headers:

              corsHeaders,

          }

        );

      } catch (error) {

        console.error(

          "Admin leads error:",

          error

        );

        return Response.json(

          {

            success: false,

            message:

              "No fue posible cargar las solicitudes.",

          },

          {

            status: 500,

            headers:

              corsHeaders,

          }

        );

      }

    }

    // ==========================================

    // PANEL ADMIN - CAMBIAR ESTADO

    // ==========================================

    if (

      request.method === "PATCH" &&

      url.pathname.startsWith(

        "/admin/leads/"

      ) &&

      url.pathname.endsWith(

        "/status"

      )

    ) {

      if (

        !isAdminAuthorized(

          request,

          env

        )

      ) {

        return Response.json(

          {

            success: false,

            message:

              "Acceso no autorizado.",

          },

          {

            status: 401,

            headers:

              corsHeaders,

          }

        );

      }

      try {

        const parts =

          url.pathname.split("/");

        const requestId =

          decodeURIComponent(

            parts[3] || ""

          );

        if (

          !requestId ||

          requestId.length > 80

        ) {

          return Response.json(

            {

              success: false,

              message:

                "Folio no válido.",

            },

            {

              status: 400,

              headers:

                corsHeaders,

            }

          );

        }

        const body =

          await request.json();

        const status =

          String(

            body.status || ""

          ).trim();

        if (

          !ADMIN_ALLOWED_STATUSES.has(

            status

          )

        ) {

          return Response.json(

            {

              success: false,

              message:

                "Estado no válido.",

            },

            {

              status: 400,

              headers:

                corsHeaders,

            }

          );

        }

        const followUpStatus =

          status === "new"

            ? "pending"

            : "completed";

        const updateResult =

          await env.DB.prepare(`

            UPDATE leads

            SET

              status = ?,

              follow_up_status = ?,

              updated_at = CURRENT_TIMESTAMP

            WHERE request_id = ?

          `)

            .bind(

              status,

              followUpStatus,

              requestId

            )

            .run();

        const changes =

          Number(

            updateResult.meta

              ?.changes || 0

          );

        if (

          changes === 0

        ) {

          return Response.json(

            {

              success: false,

              message:

                "No encontré ese folio.",

            },

            {

              status: 404,

              headers:

                corsHeaders,

            }

          );

        }

        const lead =

          await env.DB.prepare(`

            SELECT

              request_id,

              name,

              status

            FROM leads

            WHERE request_id = ?

            LIMIT 1

          `)

            .bind(

              requestId

            )

            .first();

        if (

          env.TELEGRAM_BOT_TOKEN &&

          env.TELEGRAM_CHAT_ID

        ) {

          ctx.waitUntil(

            sendAdminStatusTelegram(

              env,
              lead

            ).catch(

              (error) => {

                console.error(

                  "Admin Telegram status error:",

                  error

                );

              }

            )

          );

        }

        return Response.json(

          {

            success: true,

            request_id:

              requestId,

            status,

            follow_up_status:

              followUpStatus,

          },

          {

            headers:

              corsHeaders,

          }

        );

      } catch (error) {

        console.error(

          "Admin status error:",

          error

        );

        return Response.json(

          {

            success: false,

            message:

              "No fue posible actualizar el estado.",

          },

          {

            status: 500,

            headers:

              corsHeaders,

          }

        );

      }

    }

// ==========================================

// PANEL ADMIN - GUARDAR GESTIÓN DEL ASUNTO

// ==========================================

if (

  request.method === "PATCH" &&

  url.pathname.startsWith("/admin/leads/") &&

  url.pathname.endsWith("/details")

) {

  if (!isAdminAuthorized(request, env)) {

    return Response.json(

      {

        success: false,

        message: "Acceso no autorizado.",

      },

      {

        status: 401,

        headers: corsHeaders,

      }

    );

  }

  try {

    const parts = url.pathname.split("/");

    const requestId = decodeURIComponent(

      parts[3] || ""

    );

    if (

      !requestId ||

      requestId.length > 80

    ) {

      return Response.json(

        {

          success: false,

          message: "Folio no válido.",

        },

        {

          status: 400,

          headers: corsHeaders,

        }

      );

    }

    const body = await request.json();

    const professionalAssigned =

      String(

        body.professional_assigned || ""

      ).trim();

    const documentsStatus =

      String(

        body.documents_status || "pending"

      ).trim();

    const priority =

      String(

        body.priority || "normal"

      ).trim();

    const allowedDocuments =

      new Set([

        "pending",

        "requested",

        "partial",

        "received",

        "not_required",

      ]);

    const allowedPriorities =

      new Set([

        "normal",

        "high",

      ]);

    if (

      professionalAssigned.length > 120

    ) {

      return Response.json(

        {

          success: false,

          message:

            "El nombre del profesional es demasiado largo.",

        },

        {

          status: 400,

          headers: corsHeaders,

        }

      );

    }

    if (

      !allowedDocuments.has(

        documentsStatus

      )

    ) {

      return Response.json(

        {

          success: false,

          message:

            "Estado de documentos no válido.",

        },

        {

          status: 400,

          headers: corsHeaders,

        }

      );

    }

    if (

      !allowedPriorities.has(

        priority

      )

    ) {

      return Response.json(

        {

          success: false,

          message:

            "Prioridad no válida.",

        },

        {

          status: 400,

          headers: corsHeaders,

        }

      );

    }

    const updateResult =

      await env.DB.prepare(`

        UPDATE leads

        SET

          professional_assigned = ?,

          documents_status = ?,

          priority = ?,

          updated_at = CURRENT_TIMESTAMP

        WHERE request_id = ?

      `)

        .bind(

          professionalAssigned || null,

          documentsStatus,

          priority,

          requestId

        )

        .run();

    const changes =

      Number(

        updateResult.meta?.changes || 0

      );

    if (changes === 0) {

      return Response.json(

        {

          success: false,

          message:

            "No encontré ese folio.",

        },

        {

          status: 404,

          headers: corsHeaders,

        }

      );

    }

    return Response.json(

      {

        success: true,

        request_id: requestId,

        professional_assigned:

          professionalAssigned || null,

        documents_status:

          documentsStatus,

        priority,

      },

      {

        headers: corsHeaders,

      }

    );

  } catch (error) {

    console.error(

      "Admin details error:",

      error

    );

    return Response.json(

      {

        success: false,

        message:

          "No fue posible guardar los datos de gestión.",

      },

      {

        status: 500,

        headers: corsHeaders,

      }

    );

  }

}

    // ==========================================

    // ESTADO DEL BACKEND

    // ==========================================

    if (

      request.method === "GET" &&

      url.pathname === "/"

    ) {

      const result =

        await env.DB.prepare(

          "SELECT 1 AS ok"

        ).run();

      return Response.json(

        {

          service:

            "DAUREL backend",

          status:

            "online",

          database:

            result.success

              ? "connected"

              : "error",

          protection:

            "turnstile",

          telegram:

            env.TELEGRAM_BOT_TOKEN &&

            env.TELEGRAM_CHAT_ID

              ? "configured"

              : "not_configured",

          telegram_webhook:

            env.TELEGRAM_WEBHOOK_SECRET

              ? "ready"

              : "missing_secret",

          follow_ups:

            "ready",

          admin_panel:

            env.ADMIN_API_KEY

              ? "ready"

              : "missing_secret",

        },

        {

          headers:

            corsHeaders,

        }

      );

    }

    // ==========================================

    // NUEVA SOLICITUD

    // ==========================================

    if (

      request.method === "POST" &&

      url.pathname === "/solicitudes"

    ) {

      try {

        const data =

          await request.json();

        // TURNSTILE

        const turnstileToken =

          String(

            data.turnstile_token ||

            data[

              "cf-turnstile-response"

            ] ||

            ""

          );

        if (

          !turnstileToken ||

          turnstileToken.length >

            2048

        ) {

          return errorResponse(

            "No fue posible verificar que la solicitud sea legítima.",

            403,

            corsHeaders

          );

        }

        const turnstileResult =

          await verifyTurnstile(

            turnstileToken,

            request,

            env

          );

        if (

          !turnstileResult.success ||

          !ALLOWED_TURNSTILE_HOSTNAMES.has(

            turnstileResult.hostname

          )

        ) {

          return errorResponse(

            "La verificación de seguridad no fue válida. Inténtalo nuevamente.",
            403,

            corsHeaders

          );

        }

        // VALIDACIONES

        if (

          ![

            "particular",

            "empresa",

          ].includes(

            data.persona

          )

        ) {

          return errorResponse(

            "Selecciona si eres particular o empresa.",

            400,

            corsHeaders

          );

        }

        const name =

          String(

            data.name || ""

          ).trim();

        if (

          name.length < 2

        ) {

          return errorResponse(

            "El nombre debe tener al menos 2 caracteres.",

            400,

            corsHeaders

          );

        }

        const whatsapp =

          String(

            data.whatsapp || ""

          ).replace(

            /\D/g,

            ""

          );

        if (

          whatsapp.length <

            10 ||

          whatsapp.length >

            15

        ) {

          return errorResponse(

            "El número de WhatsApp no es válido.",

            400,

            corsHeaders

          );

        }

        const location =

          String(

            data.location || ""

          ).trim();

        if (

          location.length < 2

        ) {

          return errorResponse(

            "Indica tu ubicación.",

            400,

            corsHeaders

          );

        }

        const situation =

          String(

            data.situation || ""

          ).trim();

        if (

          situation.length < 12

        ) {

          return errorResponse(

            "Cuéntanos un poco más sobre tu situación.",

            400,

            corsHeaders

          );

        }

        if (

          data.privacy_consent !==

          true

        ) {

          return errorResponse(

            "Es necesario aceptar el aviso de privacidad.",

            400,

            corsHeaders

          );

        }

        // WHATSAPP

        let whatsappE164 =

          whatsapp;

        if (

          whatsapp.length === 10

        ) {

          whatsappE164 =

            `52${whatsapp}`;

        }

        // FECHA MÉXICO

        const dateParts =

          new Intl.DateTimeFormat(

            "en-CA",

            {

              timeZone:

                "America/Mexico_City",

              year:

                "numeric",

              month:

                "2-digit",

              day:

                "2-digit",

            }

          ).formatToParts(

            new Date()

          );

        const getDatePart =

          (type) =>

            dateParts.find(

              (part) =>

                part.type === type

            )?.value;

        const dateCode =

          getDatePart("year") +

          getDatePart("month") +

          getDatePart("day");

        // NORMALIZAR

        const keyAnswer =

          String(

            data.key_answer || ""

          ).trim();

        const categoryFront =

          String(

            data.category_front ||

            "general"

          ).trim();

        const categoryInternal =

          String(

            data.category_internal ||

            categoryFront ||

            "general"

          ).trim();

        const urgency =

          String(

            data.urgency ||

            "unknown"

          ).trim();

        const priority =

          String(

            data.priority ||

            "normal"

          ).trim();

        // CREAR FOLIO Y GUARDAR

        let requestId =

          null;

        let inserted =

          false;

        for (

          let attempt = 0;

          attempt < 10;

          attempt++

        ) {

          const randomNumber =

            crypto.getRandomValues(

              new Uint32Array(1)

            )[0];

          const suffix =

            String(

              randomNumber %

              10000

            ).padStart(

              4,

              "0"

            );

          requestId =

            `DAU-${dateCode}-${suffix}`;

          try {

            await env.DB.prepare(`

              INSERT INTO leads (

                request_id,

                persona,

                name,

                whatsapp,

                whatsapp_e164,

                email,

                location,

                situation,

                key_answer,

                category_front,

                category_internal,

                urgency,

                priority,

                routing_queue,

                status,

                follow_up_status,

                follow_up_count,

                privacy_consent,

                privacy_consent_at,

                needs_human_review,

                professional_assigned,

                deadline_verified,

                deadline_basis,

                deadline_notes,

                documents_status,

                documents_requested

              )

              VALUES (

                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,

                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?

              )

            `)

              .bind(

                requestId,

                data.persona,

                name,

                whatsapp,

                whatsappE164,

                data.email ||

                  null,

                location,

                situation,

                keyAnswer ||

                  null,

                categoryFront ||

                  null,

                categoryInternal ||

                  null,

                urgency,

                priority,

                data.routing_queue ||

                  null,

                "new",

                "pending",

                0,

                1,

                new Date()

                  .toISOString(),

                data.needs_human_review

                  ? 1

                  : 0,

                null,

                0,

                null,

                null,

                "pending",

                null

              )

              .run();

            inserted =

              true;

            break;

          } catch (error) {

            if (

              !String(

                error

              ).includes(

                "UNIQUE"

              )

            ) {

              throw error;

            }

          }

        }

        if (!inserted) {

          throw new Error(

            "No fue posible generar un folio único."

          );

        }

        // TELEGRAM

        if (

          env.TELEGRAM_BOT_TOKEN &&

          env.TELEGRAM_CHAT_ID

        ) {

          ctx.waitUntil(

            sendTelegramNotification(

              env,

              {

                requestId,

                persona:

                  data.persona,

                name,

                whatsappE164,

                location,

                situation,

                keyAnswer,

                category:

                  categoryInternal,

                urgency,

                priority,

              }

            ).catch(

              (error) => {

                console.error(

                  "Telegram notification error:",

                  error

                );

              }

            )

          );

        }

        return Response.json(

          {

            success: true,

            request_id:

              requestId,

            message:

              "Tu solicitud fue recibida correctamente. Nuestro equipo la revisará para indicarte los siguientes pasos.",

          },

          {

            status: 201,

            headers:
              corsHeaders,

          }

        );

      } catch (error) {

        console.error(

          "Solicitud error:",

          error

        );

        return errorResponse(

          "Ocurrió un error al procesar la solicitud.",

          500,

          corsHeaders

        );

      }

    }

    return errorResponse(

      "Ruta no encontrada.",

      404,

      corsHeaders

    );

  },

  // ==========================================

  // CRON

  // ==========================================

  async scheduled(

    controller,

    env,

    ctx

  ) {

    ctx.waitUntil(

      runFollowUps(env)

    );

  },

};

// ==================================================

// AUTORIZACIÓN PANEL

// ==================================================

function isAdminAuthorized(

  request,

  env

) {

  if (

    !env.ADMIN_API_KEY

  ) {

    return false;

  }

  const authorization =

    String(

      request.headers.get(

        "Authorization"

      ) || ""

    );

  const expected =

    `Bearer ${env.ADMIN_API_KEY}`;

  return (

    authorization === expected

  );

}

// ==================================================

// AVISO TELEGRAM DESDE PANEL

// ==================================================

async function sendAdminStatusTelegram(

  env,

  lead

) {

  if (!lead) {

    return;

  }

  const labels = {

    new: "Nueva",

    contacted: "Contactada",

    in_attention:

      "En atención",

    closed: "Cerrada",

  };

  const message = [

    "🗂️ ESTADO ACTUALIZADO",

    "",

    `Folio: ${lead.request_id}`,

    `Cliente: ${lead.name || "Sin nombre"}`,

    `Estado: ${

      labels[lead.status] ||

      lead.status

    }`,

    "",

    "Cambio realizado desde el panel interno de DAUREL.",

  ].join("\n");

  await sendTelegramMessage(

    env,

    message

  );

}

// ==================================================

// CONFIGURAR WEBHOOK TELEGRAM

// ==================================================

async function setupTelegramWebhook(

  request,

  env

) {

  if (

    !env.TELEGRAM_BOT_TOKEN ||

    !env.TELEGRAM_CHAT_ID ||

    !env.TELEGRAM_WEBHOOK_SECRET

  ) {

    return Response.json(

      {

        success: false,

        message:

          "Falta configuración de Telegram.",

      },

      {

        status: 500,

      }

    );

  }

  const baseUrl =

    new URL(

      request.url

    ).origin;

  const webhookUrl =

    `${baseUrl}/telegram-webhook`;

  const response =

    await fetch(

      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,

      {

        method:

          "POST",

        headers: {

          "Content-Type":

            "application/json",

        },

        body:

          JSON.stringify({

            url:

              webhookUrl,

            secret_token:

              env.TELEGRAM_WEBHOOK_SECRET,

            allowed_updates:

              [

                "callback_query",

              ],

          }),

      }

    );

  const result =

    await response.json();

  if (

    !response.ok ||

    !result.ok

  ) {

    return Response.json(

      {

        success: false,

        message:

          result.description ||

          "No fue posible configurar el webhook.",

      },

      {

        status: 500,

      }

    );

  }

  return Response.json({

    success:

      true,

    message:

      "Webhook de Telegram configurado.",

    webhook:

      webhookUrl,

  });

}

// ==================================================

// BOTONES TELEGRAM

// ==================================================

async function handleTelegramWebhook(

  request,

  env,

  ctx

) {

  const receivedSecret =

    request.headers.get(

      "X-Telegram-Bot-Api-Secret-Token"

    );

  if (

    !env.TELEGRAM_WEBHOOK_SECRET ||

    receivedSecret !==

      env.TELEGRAM_WEBHOOK_SECRET

  ) {

    return new Response(

      "Unauthorized",

      {

        status: 401,

      }

    );

  }

  try {

    const update =

      await request.json();

    const callback =

      update.callback_query;

    if (!callback) {

      return new Response(

        "OK",

        {

          status: 200,

        }

      );

    }

    const expectedChatId =

      String(

        env.TELEGRAM_CHAT_ID ||

        ""

      );

    const fromId =

      String(

        callback.from?.id ||

        ""

      );

    const callbackChatId =

      String(

        callback.message?.chat?.id ||

        ""

      );

    if (

      !expectedChatId ||

      fromId !==

        expectedChatId ||

      callbackChatId !==

        expectedChatId

    ) {

      await answerCallbackQuery(

        env,

        callback.id,

        "Acción no autorizada.",

        true

      );

      return new Response(

        "OK",

        {

          status: 200,

        }

      );

    }

    const callbackData =

      String(

        callback.data ||

        ""

      );

    const [

      action,

      requestId,

      status,

    ] =

      callbackData.split(

        ":"

      );

    if (

      action !== "status" ||

      !requestId ||

      !TELEGRAM_STATUS_LABELS[

        status

      ]

    ) {

      await answerCallbackQuery(

        env,

        callback.id,

        "Acción no reconocida.",

        true

      );

      return new Response(

        "OK",

        {

          status: 200,

        }

      );

    }

    const updateResult =

      await env.DB.prepare(`

        UPDATE leads

        SET

          status = ?,

          follow_up_status = 'completed',

          updated_at = CURRENT_TIMESTAMP

        WHERE request_id = ?

      `)

        .bind(

          status,

          requestId

        )

        .run();

    const changes =

      Number(

        updateResult.meta

          ?.changes || 0

      );

    if (

      changes === 0

    ) {

      await answerCallbackQuery(
        env,

        callback.id,

        "No encontré ese folio en DAUREL.",

        true

      );

      return new Response(

        "OK",

        {

          status: 200,

        }

      );

    }

    const label =

      TELEGRAM_STATUS_LABELS[

        status

      ];

    await answerCallbackQuery(

      env,

      callback.id,

      `Estado actualizado: ${label}`,

      false

    );

    const originalText =

      String(

        callback.message

          ?.text || ""

      ).trim();

    const cleanedText =

      originalText.replace(

        /\n\n✅ Estado DAUREL:.\*$/s,

        ""

      );

    const newText =

      `${cleanedText}\n\n✅ Estado DAUREL: ${label}`;

    ctx.waitUntil(

      editTelegramMessage(

        env,

        callback.message

          .chat.id,

        callback.message

          .message_id,

        newText

      ).catch(

        (error) => {

          console.error(

            "Telegram edit error:",

            error

          );

        }

      )

    );

    return new Response(

      "OK",

      {

        status: 200,

      }

    );

  } catch (error) {

    console.error(

      "Telegram webhook error:",

      error

    );

    return new Response(

      "OK",

      {

        status: 200,

      }

    );

  }

}

// ==================================================

// SEGUIMIENTOS

// ==================================================

async function runFollowUps(

  env

) {

  // DÍA 3

  const day3Result =

    await env.DB.prepare(`

      SELECT

        request_id,

        name,

        whatsapp_e164,

        location,

        category_internal,

        urgency,

        priority,

        created_at

      FROM leads

      WHERE status = 'new'

        AND follow_up_status = 'pending'

        AND follow_up_count = 1

        AND created_at <= datetime('now', '-3 days')

      ORDER BY created_at ASC

      LIMIT 50

    `).all();

  for (

    const lead of

      day3Result.results ||

      []

  ) {

    try {

      await sendFollowUpTelegram(

        env,

        lead,

        2

      );

      await env.DB.prepare(`

        UPDATE leads

        SET

          follow_up_count = 2,

          follow_up_status = 'completed',

          updated_at = CURRENT_TIMESTAMP

        WHERE request_id = ?

          AND status = 'new'

          AND follow_up_count = 1

          AND follow_up_status = 'pending'

      `)

        .bind(

          lead.request_id

        )

        .run();

    } catch (error) {

      console.error(

        `Error día 3 ${lead.request_id}:`,

        error

      );

    }

  }

  // DÍA 1

  const day1Result =

    await env.DB.prepare(`

      SELECT

        request_id,

        name,

        whatsapp_e164,

        location,

        category_internal,

        urgency,

        priority,

        created_at

      FROM leads

      WHERE status = 'new'

        AND follow_up_status = 'pending'

        AND follow_up_count = 0

        AND created_at <= datetime('now', '-1 day')

      ORDER BY created_at ASC

      LIMIT 50

    `).all();

  for (

    const lead of

      day1Result.results ||

      []

  ) {

    try {

      await sendFollowUpTelegram(

        env,

        lead,

        1

      );

      await env.DB.prepare(`

        UPDATE leads

        SET

          follow_up_count = 1,

          updated_at = CURRENT_TIMESTAMP

        WHERE request_id = ?

          AND status = 'new'

          AND follow_up_count = 0

          AND follow_up_status = 'pending'

      `)

        .bind(

          lead.request_id

        )

        .run();

    } catch (error) {

      console.error(

        `Error día 1 ${lead.request_id}:`,

        error

      );

    }

  }

}

// ==================================================

// TELEGRAM SEGUIMIENTO

// ==================================================

async function sendFollowUpTelegram(

  env,

  lead,

  followUpNumber

) {

  const isDayOne =

    followUpNumber === 1;

  const title =

    isDayOne

      ? "⏰ SEGUIMIENTO DAUREL — DÍA 1"

      : "⏰ SEGUIMIENTO DAUREL — DÍA 3";

  const action =

    isDayOne

      ? "Han pasado aproximadamente 24 horas. Revisa si este cliente sigue pendiente de contacto."

      : "Han pasado aproximadamente 3 días. Este es el segundo y último seguimiento automático.";

  const suggestedMessage =

    isDayOne

      ? `Hola, ${lead.name}. Te escribimos de DAUREL para dar seguimiento a tu solicitud ${lead.request_id}. Queremos confirmar si aún deseas que continuemos con la revisión. La revisión inicial de tu solicitud no genera ningún cargo. Si para continuar se requiere un servicio profesional, primero te explicaremos qué comprende y cuál sería su costo.`

      : `Hola, ${lead.name}. Te escribimos nuevamente de DAUREL respecto de tu solicitud ${lead.request_id}. Si aún requieres apoyo, podemos continuar con la revisión e indicarte los siguientes pasos. Si ya no lo necesitas, no es necesario responder.`;

  const message = [

    title,

    "",

    `Folio: ${lead.request_id}`,

    `Nombre: ${lead.name}`,

    `Categoría: ${capitalize(

      lead.category_internal

    )}`,

    `Ubicación: ${lead.location}`,

    `WhatsApp: +${lead.whatsapp_e164}`,

    "",

    action,

    "",

    "Mensaje sugerido para el cliente:",

    suggestedMessage,

    "",

    `Abrir WhatsApp: https://wa.me/${lead.whatsapp_e164}`,

  ].join("\n");

  await sendTelegramMessage(

    env,

    message,

    buildStatusKeyboard(

      lead.request_id

    )

  );

}

// ==================================================

// NUEVA SOLICITUD TELEGRAM

// ==================================================

async function sendTelegramNotification(

  env,

  lead

) {

  const urgencyLabel =

    formatUrgency(

      lead.urgency

    );

  const priorityLabel =

    lead.priority ===

    "high"

      ? "ALTA"

      : "Normal";

  const message = [

    "🔔 NUEVA SOLICITUD DAUREL",

    "",

    `Folio: ${lead.requestId}`,

    `Persona: ${capitalize(

      lead.persona

    )}`,

    `Categoría: ${capitalize(

      lead.category

    )}`,

    `Urgencia: ${urgencyLabel}`,

    `Prioridad: ${priorityLabel}`,

    "",

    `Nombre: ${lead.name}`,

    `WhatsApp: +${lead.whatsappE164}`,

    `Ubicación: ${lead.location}`,

    "",

    "Situación:",

    limitText(

      lead.situation,

      900

    ),

    "",

    `Respuesta clave: ${

      lead.keyAnswer

        ? limitText(

            lead.keyAnswer,

            300

          )

        : "Sin respuesta adicional"

    }`,

    "",

    `Abrir WhatsApp: https://wa.me/${lead.whatsappE164}`,

  ].join("\n");

  await sendTelegramMessage(

    env,

    message,

    buildStatusKeyboard(

      lead.requestId

    )

  );

}

// ==================================================

// BOTONES

// ==================================================

function buildStatusKeyboard(

  requestId

) {

  return {

    inline_keyboard: [

      [

        {

          text:

            "✅ Contactada",

          callback_data:

            `status:${requestId}:contacted`,

        },

      ],

      [

        {

          text:

            "🟡 En atención",

          callback_data:

            `status:${requestId}:in_attention`,
        },

      ],

      [

        {

          text:

            "🏁 Cerrada",

          callback_data:

            `status:${requestId}:closed`,

        },

      ],

    ],

  };

}

// ==================================================

// TELEGRAM GENERAL

// ==================================================

async function sendTelegramMessage(

  env,

  message,

  replyMarkup = null

) {

  const payload = {

    chat_id:

      env.TELEGRAM_CHAT_ID,

    text:

      message,

    disable_web_page_preview:

      true,

  };

  if (replyMarkup) {

    payload.reply_markup =

      replyMarkup;

  }

  const response =

    await fetch(

      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,

      {

        method:

          "POST",

        headers: {

          "Content-Type":

            "application/json",

        },

        body:

          JSON.stringify(

            payload

          ),

      }

    );

  const result =

    await response.json();

  if (

    !response.ok ||

    !result.ok

  ) {

    throw new Error(

      `Telegram API: ${

        result.description ||

        response.status

      }`

    );

  }

  return result;

}

async function answerCallbackQuery(

  env,

  callbackQueryId,

  text,

  showAlert

) {

  await fetch(

    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,

    {

      method:

        "POST",

      headers: {

        "Content-Type":

          "application/json",

      },

      body:

        JSON.stringify({

          callback_query_id:

            callbackQueryId,

          text,

          show_alert:

            showAlert,

          cache_time:

            0,

        }),

    }

  );

}

async function editTelegramMessage(

  env,

  chatId,

  messageId,

  text

) {

  const response =

    await fetch(

      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`,

      {

        method:

          "POST",

        headers: {

          "Content-Type":

            "application/json",

        },

        body:

          JSON.stringify({

            chat_id:

              chatId,

            message_id:

              messageId,

            text,

            disable_web_page_preview:

              true,

          }),

      }

    );

  const result =

    await response.json();

  if (

    !response.ok ||

    !result.ok

  ) {

    throw new Error(

      result.description ||

      "No fue posible editar Telegram."

    );

  }

}

// ==================================================

// TURNSTILE

// ==================================================

async function verifyTurnstile(

  token,

  request,

  env

) {

  try {

    const response =

      await fetch(

        "https://challenges.cloudflare.com/turnstile/v0/siteverify",

        {

          method:

            "POST",

          headers: {

            "Content-Type":

              "application/json",

          },

          body:

            JSON.stringify({

              secret:

                env.TURNSTILE_SECRET,

              response:

                token,

              remoteip:

                request.headers.get(

                  "CF-Connecting-IP"

                ) ||

                undefined,

            }),

        }

      );

    if (!response.ok) {

      return {

        success:

          false,

      };

    }

    return await response.json();

  } catch (error) {

    console.error(

      "Turnstile error:",

      error

    );

    return {

      success:

        false,

    };

  }

}

// ==================================================

// AUXILIARES

// ==================================================

function formatUrgency(

  urgency

) {

  const labels = {

    "48h":

      "Menos de 48 horas",

    soon:

      "Hay fecha próxima",

    no:

      "Sin fecha próxima",

    unknown:

      "No está seguro",

  };

  return (

    labels[urgency] ||

    urgency ||

    "No indicada"

  );

}

function capitalize(

  value

) {

  const text =

    String(

      value || ""

    ).trim();

  if (!text) {

    return "No indicada";

  }

  return (

    text.charAt(0)

      .toUpperCase() +

    text.slice(1)

  );

}

function limitText(

  value,

  maxLength

) {

  const text =

    String(

      value || ""

    ).trim();

  if (

    text.length <=

    maxLength

  ) {

    return text;

  }

  return (

    text.slice(

      0,

      maxLength

    ) + "…"

  );

}

function errorResponse(

  message,

  status,

  corsHeaders

) {

  return Response.json(

    {

      success:

        false,

      message,

    },

    {

      status,

      headers:

        corsHeaders,

    }

  );

}

function jsonResponse(

  body,

  status,

  origin

) {

  return Response.json(

    body,

    {

      status,

      headers: {

        "Access-Control-Allow-Origin":

          ALLOWED_ORIGINS.has(

            origin

          )

            ? origin

            : "https://daurel.com.mx",

        "Vary":

          "Origin",

      },

    }

  );

}
