-- DAUREL V2 / Auditoría de estructura V1.
-- EJECUTAR ÚNICAMENTE COMO SELECT en Cloudflare D1 -> daurel-db -> Explore Data.
-- No devuelve solicitudes, nombres, teléfonos, datos personales ni contenido de expedientes.
-- No modifica tablas, registros, permisos ni índices.
-- No cambiar ni ampliar esta consulta para mostrar registros de clientes.

SELECT
  m.name AS tabla,
  group_concat(
    p.name || ' (' || COALESCE(NULLIF(p.type, ''), 'sin tipo') || ')',
    ', '
  ) AS columnas
FROM sqlite_master AS m
JOIN pragma_table_info(m.name) AS p
WHERE m.type = 'table'
  AND m.name NOT LIKE 'sqlite_%'
GROUP BY m.name
ORDER BY m.name;
