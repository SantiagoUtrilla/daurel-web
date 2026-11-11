-- DAUREL V2 | Revisión de estructura y conteos de leads V1.
-- SOLO LECTURA en Cloudflare D1 -> daurel-db -> Studio.
-- Una única instrucción SELECT, sin UNION ALL ni PRAGMA tabular.
-- No devuelve filas de personas, nombres, teléfonos, folios ni descripciones.

SELECT
  COUNT(*) AS total_solicitudes,
  COUNT(DISTINCT request_id) AS folios_distintos,
  COALESCE(SUM(
    CASE WHEN request_id IS NULL OR TRIM(request_id) = ''
         THEN 1 ELSE 0 END
  ), 0) AS folios_vacios,
  COALESCE(SUM(
    CASE WHEN privacy_consent = 1
          AND (privacy_consent_at IS NULL OR TRIM(privacy_consent_at) = '')
         THEN 1 ELSE 0 END
  ), 0) AS consentimientos_sin_fecha,
  (
    SELECT GROUP_CONCAT(etiqueta || ': ' || cantidad, ' | ')
    FROM (
      SELECT COALESCE(status, '(nulo)') AS etiqueta, COUNT(*) AS cantidad
      FROM leads GROUP BY status
    )
  ) AS estados,
  (
    SELECT GROUP_CONCAT(etiqueta || ': ' || cantidad, ' | ')
    FROM (
      SELECT COALESCE(urgency, '(nulo)') AS etiqueta, COUNT(*) AS cantidad
      FROM leads GROUP BY urgency
    )
  ) AS urgencias,
  (
    SELECT GROUP_CONCAT(etiqueta || ': ' || cantidad, ' | ')
    FROM (
      SELECT COALESCE(priority, '(nulo)') AS etiqueta, COUNT(*) AS cantidad
      FROM leads GROUP BY priority
    )
  ) AS prioridades
FROM leads;
