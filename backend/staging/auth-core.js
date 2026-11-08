// DAUREL V2 — Primitivas para autenticación sin contraseña.
// Módulo de desarrollo: TODAVÍA NO CONECTADO a rutas públicas.
// El inicio de sesión requiere correo verificado y permisos por party explícitos.

const enc = new TextEncoder();

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s.length < 3 || s.length > 254 || /\s/.test(s)) return null;
  // Formato conservador inicial; el proveedor de email validará la dirección.
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(s)) return null;
  if (s.split("@").length !== 2 || s.includes("..")) return null;
  return s;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2,"0")).join("");
}

export function newOtp() {
  // Rejection sampling: evita sesgo del módulo.
  const max = Math.floor(0x100000000 / 1000000) * 1000000;
  let n;
  do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= max);
  return String(n % 1000000).padStart(6,"0");
}

export async function otpHmac(email, challengeId, code, signingSecret) {
  const normalized = normalizeEmail(email);
  if (!normalized || typeof challengeId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(challengeId) ||
      !/^\d{6}$/.test(code) ||
      typeof signingSecret !== "string" || signingSecret.length < 32) {
    throw new TypeError("Parámetros de verificación inválidos");
  }
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(signingSecret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, enc.encode(normalized+"|"+challengeId+"|"+code));
  return toHex(new Uint8Array(digest));
}

export function timingSafeHexEqual(a,b) {
  if (typeof a !== "string" || typeof b !== "string" ||
      !/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

export function newSessionToken() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

export async function tokenHash(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new TypeError("Token inválido");
  }
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(token))));
}

// Una cuenta sin autorización explícita no puede consultar ningún expediente.
// La pertenencia no se infiere de coincidencias de correo ni teléfono.
export async function allowedPartiesForAccount(db, accountId) {
  const result=await db.prepare([
    "SELECT p.party_id, p.kind, p.display_name, a.permission",
    "FROM account_party_access a JOIN parties p ON p.party_id=a.party_id",
    "JOIN accounts ac ON ac.account_id=a.account_id",
    "WHERE a.account_id=? AND a.revoked_at IS NULL",
    "AND p.status='active' AND ac.status='active'",
    "ORDER BY p.created_at, p.party_id",
  ].join(" ")).bind(accountId).all();
  return result.results || [];
}
