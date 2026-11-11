-- DAUREL V2 | Auditoría agregada (únicamente lectura).
-- Base: daurel-db / Cloudflare D1 Studio.
-- NO muestra ninguna fila individual, ni datos de personas, teléfono, folios,
-- notas ni descripciones. Solo recuentos para preparar una migración segura.
-- No utilizar esta consulta si hay que conservar anonimato de grupos pequeños:
-- sus conteos son visibles solo para el administrador autorizado.

SELECT 'total_solicitudes' AS comprobacion, CAST(COUNT(*) AS TEXT) AS resultado FROM leads
UNION ALL
SELECT 'folios_distintos', CAST(COUNT(DISTINCT request_id) AS TEXT) FROM leads
UNION ALL
SELECT 'folios_nulos_o_vacios', CAST(COALESCE(SUM(CASE WHEN request_id IS NULL OR trim(request_id) = '' THEN 1 ELSE 0 END),0) AS TEXT) FROM leads
UNION ALL
SELECT 'con_consentimiento_sin_fecha', CAST(COALESCE(SUM(CASE WHEN privacy_consent = 1 AND (privacy_consent_at IS NULL OR trim(privacy_consent_at) = '') THEN 1 ELSE 0 END),0) AS TEXT) FROM leads
UNION ALL
SELECT 'categoria_estado:' || COALESCE(status, '(nulo)'), CAST(COUNT(*) AS TEXT) FROM leads GROUP BY status
UNION ALL
SELECT 'categoria_urgencia:' || COALESCE(urgency, '(nulo)'), CAST(COUNT(*) AS TEXT) FROM leads GROUP BY urgency
UNION ALL
SELECT 'categoria_prioridad:' || COALESCE(priority, '(nulo)'), CAST(COUNT(*) AS TEXT) FROM leads GROUP BY priority
ORDER BY comprobacion;
