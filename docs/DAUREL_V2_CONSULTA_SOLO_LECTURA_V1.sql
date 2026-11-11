-- DAUREL V2 · Consulta de metadatos de la tabla V1 "leads".
-- Solo lectura: no devuelve filas, nombres, teléfonos ni otros datos de clientes.
-- Compatible con Cloudflare D1. NO utilizar pragma_table_info(...) como función
-- tabular JOIN: su autorización puede fallar con SQLITE_AUTH.
-- Ejecutar exclusivamente en D1 Studio -> daurel-db.

PRAGMA table_info('leads');
