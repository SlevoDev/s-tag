require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const os = require("os");
const db = require("./db");

const compression = require("compression");
const app = express();
const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? null : "s-tag-dev-secret-change-in-production");
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET må settes i produksjon. Avbryter oppstart.");
  process.exit(1);
}
const TOKEN_TTL_DAYS = 30;

// CORS: default-liste dekker Vercel + lokal dev + Capacitor. Utvid via CORS_ORIGINS.
// VIKTIG: wildcard "*" er IKKE tillatt — bruk eksplisitte domener.
const DEFAULT_ORIGINS = [
  "https://s-tag-ten.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "capacitor://localhost",
  "http://localhost",
];
const extraOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter((s) => s && s !== "*")
  : [];
const corsOrigins = [...DEFAULT_ORIGINS, ...extraOrigins];
app.use(
  cors({
    origin: (origin, cb) => {
      // Ingen origin (mobil-app, curl, health checks) → tillat
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      // Tillat alle *.vercel.app preview-deploys
      if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: false,
  })
);
app.use(compression());
app.use(express.json({ limit: "2mb" }));

// --- Auth helpers (pure Node crypto, ingen eksterne avhengigheter) ---
// Async scrypt — blokkerer IKKE event loop under hashing (~100ms per kall).
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, s, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(`${s}:${derived.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived));
    });
  });
}

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_DAYS * 86400000 })
  );
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return res.status(401).json({ error: "Ikke innlogget" });
  }
  req.userId = payload.userId;
  next();
}

// Admin-autentisering. Brukes av /api/admin/chips for å legge inn nye
// fysisk produserte chiper. Tokenet settes i ADMIN_TOKEN og deles KUN med
// administratorer / produksjonssystemet som pre-laster chipene.
// Kall endepunktet med header: Authorization: Bearer <ADMIN_TOKEN>
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({
      error: "Admin-endepunkter er ikke konfigurert. Sett ADMIN_TOKEN i backend/.env",
    });
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Mangler admin-token" });
  // timing-safe sammenligning
  let ok = false;
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(ADMIN_TOKEN);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    ok = false;
  }
  if (!ok) return res.status(403).json({ error: "Ugyldig admin-token" });
  next();
}

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

// Async error-wrapper så vi slipper try/catch i hver route
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Rate limiting (in-memory token bucket pr. IP + rute) ---
// Hver cluster-worker har sin egen Map. For å holde den effektive grensen korrekt
// deler vi max på antall workers. Ved 4 workers med max=20 → 5 per worker = 20 totalt.
const rateLimitBuckets = new Map();
const workerCount = parseInt(process.env.WORKERS, 10) || Math.min(os.cpus().length, 4);
function rateLimit({ windowMs, max, name }) {
  const perWorkerMax = Math.max(1, Math.ceil(max / (process.env.NODE_ENV === "production" ? workerCount : 1)));
  return (req, res, next) => {
    const ip =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `${name}:${ip}`;
    const now = Date.now();
    const entry = rateLimitBuckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      rateLimitBuckets.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > perWorkerMax) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "For mange forespørsler. Prøv igjen om litt." });
    }
    next();
  };
}
// Periodisk opprydding (hvert 10. minutt) så Map ikke vokser evig
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitBuckets) {
    if (now - v.start > 60 * 60 * 1000) rateLimitBuckets.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: "auth" });
const foundLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, name: "found" });
const feedbackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, name: "feedback" });
const chipPingLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, name: "chip" });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, name: "reset" });

// --- Health ---
app.get("/api/health", h(async (_req, res) => {
  const dbHealth = await db.pingDb();
  const status = dbHealth.ok ? "ok" : "degraded";
  res.status(dbHealth.ok ? 200 : 503).json({
    status,
    service: "S-TAG backend",
    build: "2026-04-10b",
    store: dbHealth.store,
    db: dbHealth.ok ? "up" : "down",
    time: new Date().toISOString(),
  });
}));

// ============================================================================
// AUTH
// ============================================================================

const CONSENT_VERSION = process.env.CONSENT_VERSION || "2026-04";

app.post("/api/auth/register", authLimiter, h(async (req, res) => {
  const { email, password, name, acceptTerms, consentVersion } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "E-post, navn og passord er påkrevd" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Passord må være minst 8 tegn" });
  }
  if (acceptTerms !== true) {
    return res.status(400).json({
      error: "Du må godta brukervilkårene og personvernerklæringen for å opprette konto",
    });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await db.findUserByEmail(normalizedEmail);
  if (existing) return res.status(409).json({ error: "E-post er allerede registrert" });

  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name: String(name).trim(),
    passwordHash: await hashPassword(password),
    plan: "free",
    createdAt: new Date().toISOString(),
    consentTerms: true,
    consentPrivacy: true,
    consentVersion: String(consentVersion || CONSENT_VERSION),
    consentAcceptedAt: new Date().toISOString(),
  };
  const saved = await db.createUser(user);
  await db.createNotification({
    userId: saved.id,
    kind: "welcome",
    title: `Velkommen til S-TAG, ${saved.name.split(" ")[0]}!`,
    body: "Registrer din første gjenstand og aktiver chip-sporing fra Kartoteket.",
  }).catch(() => {});
  const token = signToken({ userId: saved.id });
  res.status(201).json({ token, user: publicUser(saved) });
}));

app.post("/api/auth/login", authLimiter, h(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "E-post og passord er påkrevd" });
  const user = await db.findUserByEmail(String(email).trim().toLowerCase());
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Feil e-post eller passord" });
  }
  const token = signToken({ userId: user.id });
  res.json({ token, user: publicUser(user) });
}));

app.get("/api/auth/me", requireAuth, h(async (req, res) => {
  const user = await db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Bruker ikke funnet" });
  db.touchUserLastSeen(req.userId).catch(() => {});
  res.json({ user: publicUser(user) });
}));

// Oppdater profil (navn, e-post, adresse, forsikring, varsler, samtykker)
app.patch("/api/auth/me", requireAuth, h(async (req, res) => {
  const allowed = [
    "name", "email", "phone", "address", "postalCode", "city", "avatarUrl",
    "insuranceCompany", "insurancePolicy",
    "notifyEmail", "notifyPush", "notifyMarketing",
    "consentPrivacy", "consentLocation", "consentVersion", "language",
  ];
  const patch = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  if (patch.name !== undefined) patch.name = String(patch.name).trim();

  if (patch.email !== undefined) {
    const newEmail = String(patch.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ error: "Ugyldig e-postadresse" });
    }
    const existing = await db.findUserByEmail(newEmail);
    if (existing && existing.id !== req.userId) {
      return res.status(409).json({ error: "Denne e-postadressen er allerede i bruk" });
    }
    patch.email = newEmail;
  }

  const updated = await db.updateUserProfile(req.userId, patch);
  if (!updated) return res.status(404).json({ error: "Bruker ikke funnet" });
  res.json({ user: publicUser(updated) });
}));

// ============================================================================
// OAuth (Google / Apple) — verifiserer ID-token mot leverandør og oppretter
// eller matcher bruker basert på e-post. Ingen eksterne npm-avhengigheter.
// ============================================================================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || ""; // Service ID (reverse-DNS)

// Enkel JWKS-cache så vi ikke henter nøkler på hver forespørsel
const jwksCache = new Map();
async function fetchJwks(url) {
  const cached = jwksCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Kunne ikke hente JWKS (${r.status})`);
  const j = await r.json();
  jwksCache.set(url, { keys: j.keys, expires: Date.now() + 10 * 60 * 1000 });
  return j.keys;
}

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// Verifiserer et RS256-signert ID-token mot en JWKS-endepunkt.
async function verifyIdToken(idToken, { jwksUrl, issuers, audience }) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Ugyldig token-format");
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlDecode(headerB64).toString());
  const payload = JSON.parse(b64urlDecode(payloadB64).toString());

  if (header.alg !== "RS256") throw new Error(`Uventet alg: ${header.alg}`);
  const issList = Array.isArray(issuers) ? issuers : [issuers];
  if (!issList.includes(payload.iss)) throw new Error(`Ugyldig issuer: ${payload.iss}`);
  if (audience && payload.aud !== audience) throw new Error("Ugyldig audience");
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    throw new Error("Token utløpt");
  }

  const keys = await fetchJwks(jwksUrl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Fant ikke signerings-nøkkel");

  const pubKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = b64urlDecode(sigB64);
  const ok = crypto.verify("RSA-SHA256", data, pubKey, signature);
  if (!ok) throw new Error("Ugyldig signatur");
  return payload;
}

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google-innlogging er ikke konfigurert");
  return verifyIdToken(idToken, {
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    audience: GOOGLE_CLIENT_ID,
  });
}

async function verifyAppleToken(idToken) {
  if (!APPLE_CLIENT_ID) throw new Error("Apple-innlogging er ikke konfigurert");
  return verifyIdToken(idToken, {
    jwksUrl: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    audience: APPLE_CLIENT_ID,
  });
}

app.post("/api/auth/oauth", authLimiter, h(async (req, res) => {
  const { provider, idToken, name: fallbackName, acceptTerms, consentVersion } = req.body || {};
  if (!provider || !idToken) {
    return res.status(400).json({ error: "provider og idToken er påkrevd" });
  }

  let claims;
  try {
    if (provider === "google") claims = await verifyGoogleToken(idToken);
    else if (provider === "apple") claims = await verifyAppleToken(idToken);
    else return res.status(400).json({ error: "Ukjent provider" });
  } catch (err) {
    return res.status(401).json({ error: err.message || "Token-verifisering feilet" });
  }

  const email = String(claims.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Leverandør returnerte ingen e-post" });
  }

  let user = await db.findUserByEmail(email);
  if (!user) {
    if (acceptTerms !== true) {
      return res.status(400).json({
        error: "Du må godta brukervilkårene og personvernerklæringen for å opprette konto",
      });
    }
    const displayName =
      claims.name ||
      [claims.given_name, claims.family_name].filter(Boolean).join(" ") ||
      fallbackName ||
      email.split("@")[0];
    user = await db.createUser({
      id: crypto.randomUUID(),
      email,
      name: String(displayName).trim(),
      // Tilfeldig passord-hash — brukeren logger kun inn via OAuth (eller
      // kan sette nytt passord senere via "glemt passord"-flyt).
      passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
      plan: "free",
      createdAt: new Date().toISOString(),
      consentTerms: true,
      consentPrivacy: true,
      consentVersion: String(consentVersion || CONSENT_VERSION),
      consentAcceptedAt: new Date().toISOString(),
    });
    await db.createNotification({
      userId: user.id,
      kind: "welcome",
      title: `Velkommen til S-TAG, ${user.name.split(" ")[0]}!`,
      body: `Du logget inn med ${provider === "google" ? "Google" : "Apple"}. Registrer din første S-TAG-merkede gjenstand fra Kartoteket.`,
    }).catch(() => {});
  }

  const token = signToken({ userId: user.id });
  res.json({ token, user: publicUser(user) });
}));

// Endre passord
app.post("/api/auth/password", requireAuth, h(async (req, res) => {
  const oldPassword = typeof req.body?.oldPassword === "string" ? req.body.oldPassword.trim() : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword.trim() : "";
  if (!oldPassword || !newPassword) return res.status(400).json({ error: "Oppgi gammelt og nytt passord" });
  if (newPassword.length < 8) return res.status(400).json({ error: "Nytt passord må være minst 8 tegn" });
  if (newPassword.length > 256) return res.status(400).json({ error: "Passord for langt" });
  const user = await db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Bruker ikke funnet" });
  if (!(await verifyPassword(oldPassword, user.passwordHash))) {
    return res.status(401).json({ error: "Feil gammelt passord" });
  }
  await db.updateUserPassword(req.userId, await hashPassword(newPassword));
  res.json({ ok: true });
}));

// ============================================================================
// GLEMT PASSORD (password reset via e-post)
// ============================================================================
// Flyten:
//   1. Bruker ber om tilbakestilling via POST /api/auth/forgot-password
//   2. Backend genererer en tidsbegrenset token (1 time), sender e-post via Resend
//   3. Bruker klikker link → frontend /tilbakestill-passord?token=xxx
//   4. Frontend sender POST /api/auth/reset-password med token + nytt passord
//
// I dev uten RESEND_API_KEY logges reset-lenken til konsollen.

const resetTokens = new Map(); // token → { userId, email, createdAt }
const RESET_TTL_MS = 60 * 60 * 1000; // 1 time

// Rydd utløpte tokens hvert 10. minutt
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of resetTokens) {
    if (now - v.createdAt > RESET_TTL_MS) resetTokens.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

app.post("/api/auth/forgot-password", resetLimiter, h(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "E-post er påkrevd" });

  // VIKTIG: Returnér alltid 200 uansett om brukeren finnes eller ikke.
  // Forhindrer e-post-enumerering.
  const user = await db.findUserByEmail(email);
  if (!user) {
    // Vent litt for å unngå timing-analyse
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    return res.json({ ok: true });
  }

  // Generer token
  const token = crypto.randomBytes(32).toString("hex");
  resetTokens.set(token, { userId: user.id, email, createdAt: Date.now() });

  const resetUrl = `${APP_BASE_URL}/tilbakestill-passord?token=${token}`;

  // Send e-post via Resend (eller logg i dev)
  if (RESEND_API_KEY) {
    const firstName = user.name.split(" ")[0];
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FEEDBACK_FROM,
          to: [email],
          subject: "Tilbakestill passordet ditt — S-TAG",
          html: `
            <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0f172a;">
              <h1 style="font-size:22px;margin:0 0 8px 0;">Hei, ${firstName}</h1>
              <p style="color:#475569;line-height:1.6;margin:0 0 24px 0;">
                Vi mottok en forespørsel om å tilbakestille passordet ditt.
                Klikk knappen under for å velge et nytt passord.
              </p>
              <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background:#0f2a5c;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px;">
                Tilbakestill passord
              </a>
              <p style="color:#94a3b8;font-size:12px;margin:24px 0 0 0;line-height:1.5;">
                Lenken er gyldig i 1 time. Hvis du ikke ba om dette, kan du trygt ignorere denne e-posten.
              </p>
            </div>
          `,
          text: `Tilbakestill passord: ${resetUrl}\n\nLenken er gyldig i 1 time.`,
        }),
      });
    } catch (err) {
      console.error("[RESET-MAIL] Feil:", err.message);
    }
  } else {
    console.log(`[RESET] ${email} → ${resetUrl}`);
  }

  res.json({ ok: true });
}));

app.post("/api/auth/reset-password", resetLimiter, h(async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const newPassword = String(req.body?.newPassword || "").trim();
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token og nytt passord er påkrevd" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Passord må være minst 8 tegn" });
  }
  if (newPassword.length > 256) {
    return res.status(400).json({ error: "Passord for langt" });
  }

  const entry = resetTokens.get(token);
  if (!entry || Date.now() - entry.createdAt > RESET_TTL_MS) {
    resetTokens.delete(token);
    return res.status(400).json({
      error: "Lenken er ugyldig eller utløpt. Be om en ny tilbakestilling.",
    });
  }

  await db.updateUserPassword(entry.userId, await hashPassword(newPassword));
  resetTokens.delete(token);

  res.json({ ok: true });
}));

// Slett konto (GDPR rett til sletting)
app.delete("/api/auth/me", requireAuth, h(async (req, res) => {
  await db.deleteUser(req.userId);
  res.json({ ok: true });
}));

// Eksporter alle data (GDPR dataportabilitet)
app.get("/api/auth/export", requireAuth, h(async (req, res) => {
  const user = await db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Bruker ikke funnet" });
  const items = await db.listItemsByOwner(req.userId);
  const transfers = await db.listTransfersForUser(req.userId, user.email);
  const notifications = await db.listNotifications(req.userId, 500);
  res.setHeader("Content-Disposition", `attachment; filename="s-tag-export-${user.id}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    user: publicUser(user),
    items,
    transfers,
    notifications,
  });
}));

// ============================================================================
// GEOCODING (cached Nominatim proxy)
// ============================================================================

const geocodeCache = new Map();
const geocodeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, name: "geocode" });

// Periodisk opprydding av geocode-cache (maks 5000 entries)
setInterval(() => {
  if (geocodeCache.size > 5000) {
    const toDelete = geocodeCache.size - 4000;
    const iter = geocodeCache.keys();
    for (let i = 0; i < toDelete; i++) {
      const key = iter.next().value;
      if (key) geocodeCache.delete(key);
    }
  }
}, 15 * 60 * 1000).unref?.();

app.get("/api/geocode", geocodeLimiter, h(async (req, res) => {
  const latNum = Number(req.query.lat);
  const lngNum = Number(req.query.lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: "lat and lng required" });
  }
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: "lat/lng out of range" });
  }
  const key = `${latNum.toFixed(4)},${lngNum.toFixed(4)}`;
  if (geocodeCache.has(key)) return res.json(geocodeCache.get(key));
  try {
    const qs = new URLSearchParams({
      lat: String(latNum),
      lon: String(lngNum),
      format: "json",
      "accept-language": "nb",
      zoom: "18",
    });
    const url = `https://nominatim.openstreetmap.org/reverse?${qs.toString()}`;
    const r = await fetch(url, { headers: { "User-Agent": "S-TAG/1.0" } });
    const j = await r.json();
    const a = j.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(" ");
    const area = a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || "";
    const postcode = a.postcode || "";
    const display = [street, area].filter(Boolean).join(", ") || j.display_name || "Ukjent adresse";
    const result = { display, street, area, postcode, full: j.display_name };
    geocodeCache.set(key, result);
    res.json(result);
  } catch (err) {
    res.json({ display: "Adresse ikke tilgjengelig", error: err.message });
  }
}));

// ============================================================================
// ITEMS (user-scoped)
// ============================================================================

app.get("/api/items", requireAuth, h(async (req, res) => {
  const items = await db.listItemsByOwner(req.userId);
  res.json(items);
}));

// Kontrollerer om chip-registeret skal håndheves. I produksjon er dette
// alltid PÅ. Lokalt (JSON-store uten DATABASE_URL) er det AV som default så
// utviklere slipper å seede registeret — override med STRICT_CHIP_REGISTER=1.
const STRICT_CHIP_REGISTER =
  process.env.STRICT_CHIP_REGISTER === "1" ||
  process.env.STRICT_CHIP_REGISTER === "true" ||
  IS_PRODUCTION;

// Sjekk om en S-TAG-kode er ledig (brukes av registrerings-wizard for live validering)
// Returnerer { available, reason } slik at frontend kan vise forskjell på
// "finnes ikke i registeret" vs "allerede registrert på en konto".
// MÅ ligge før /api/items/:id, ellers fanges den av :id-ruta.
app.get("/api/items/code-available", requireAuth, h(async (req, res) => {
  const code = String(req.query.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "code required" });
  if (code.length < 4 || code.length > 64) {
    return res.status(400).json({ error: "Ugyldig kodelengde" });
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return res.status(400).json({ error: "Ugyldige tegn i kode" });
  }
  const existing = await db.findItemByChipUid(code);
  if (existing) return res.json({ available: false, reason: "already_registered" });

  if (STRICT_CHIP_REGISTER) {
    const chip = await db.getChipByUid(code);
    if (!chip) return res.json({ available: false, reason: "not_in_register" });
    if (chip.status === "disabled") return res.json({ available: false, reason: "disabled" });
    if (chip.status === "claimed")  return res.json({ available: false, reason: "already_registered" });
  }

  res.json({ available: true });
}));

app.get("/api/items/:id", requireAuth, h(async (req, res) => {
  const item = await db.getItem(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
}));


app.post("/api/items", requireAuth, h(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !String(body.name).trim()) {
    return res.status(400).json({ error: "Navn er påkrevd" });
  }

  // S-TAG-kode er valgfri. Uten kode registreres gjenstanden som ren
  // verdidokumentasjon (kvitteringer, forsikringsbevis osv.). Med kode
  // aktiveres chip-sporing i tillegg.
  const rawCode = String(body.chipUid || body.stagCode || "").trim().toUpperCase();
  const stagCode = rawCode || null;

  if (stagCode) {
    if (stagCode.length < 6) {
      return res.status(400).json({ error: "S-TAG-kode virker ugyldig" });
    }
    if (!/^[A-Z0-9-]+$/.test(stagCode)) {
      return res.status(400).json({ error: "Ugyldige tegn i S-TAG-kode" });
    }

    const existing = await db.findItemByChipUid(stagCode);
    if (existing) {
      return res.status(409).json({ error: "Denne S-TAG-koden er allerede registrert" });
    }

    // Whitelist-sjekk mot chip-registeret.
    if (STRICT_CHIP_REGISTER) {
      const chip = await db.getChipByUid(stagCode);
      if (!chip) {
        return res.status(404).json({
          error: "Ukjent S-TAG-kode. Sjekk at du har skrevet koden riktig — den står på chipen eller produktets emballasje.",
        });
      }
      if (chip.status === "disabled") {
        return res.status(410).json({ error: "Denne S-TAG-chipen er deaktivert. Kontakt support." });
      }
      if (chip.status === "claimed") {
        return res.status(409).json({
          error: "Denne S-TAG-chipen er allerede registrert på en annen konto.",
        });
      }
    }
  }

  const publicCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  const now = new Date().toISOString();
  const newItem = {
    id: crypto.randomUUID(),
    ownerId: req.userId,
    name: String(body.name).trim(),
    tagId: body.tagId || `ST-${crypto.randomInt(1000, 10000)}-${crypto.randomBytes(2).toString("hex").toUpperCase().slice(0, 2)}`,
    status: "secured",
    category: body.category || "other",
    chipUid: stagCode,
    chipPairedAt: stagCode ? now : null,
    chipLastPing: null,
    chipStatus: stagCode ? "paired" : "unpaired",
    lat: body.lat ?? 59.9139,
    lng: body.lng ?? 10.7522,
    lastSeen: "Registrert nettopp",
    battery: null,
    createdAt: now,
    description: body.description || null,
    serialNumber: body.serialNumber || null,
    brand: body.brand || null,
    model: body.model || null,
    color: body.color || null,
    valueNok: body.valueNok ?? null,
    purchasedAt: body.purchasedAt || null,
    photoUrl: body.photoUrl || null,
    receiptUrl: body.receiptUrl || null,
    publicCode,
  };
  const saved = await db.createItem(newItem);
  await db.createItemEvent({ itemId: saved.id, userId: req.userId, kind: "created", detail: saved.name });

  // Markér chipen som "claimed" i registeret (kun når kode er oppgitt).
  if (stagCode && STRICT_CHIP_REGISTER) {
    const claim = await db.claimChip(stagCode, req.userId, saved.id);
    if (!claim.ok) {
      await db.deleteItem(saved.id, req.userId);
      const reason = claim.reason === "already_claimed"
        ? "Denne S-TAG-chipen ble nettopp registrert på en annen konto."
        : "Kunne ikke reservere S-TAG-chipen. Prøv igjen.";
      return res.status(409).json({ error: reason });
    }
  }

  res.status(201).json(saved);
}));

// Felter eieren selv kan endre via PATCH. Chip-, status-, posisjons- og
// kodefelter styres kun av egne endepunkter (chip/pair, lost/found, ping)
// så chip-registeret ikke kan omgås.
const ITEM_EDITABLE_FIELDS = [
  "name", "category", "description", "serialNumber", "brand", "model",
  "color", "valueNok", "purchasedAt", "photoUrl", "receiptUrl",
];

app.patch("/api/items/:id", requireAuth, h(async (req, res) => {
  const patch = {};
  for (const k of ITEM_EDITABLE_FIELDS) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  if (patch.name !== undefined && !String(patch.name).trim()) {
    return res.status(400).json({ error: "Navn kan ikke være tomt" });
  }
  const updated = await db.updateItem(req.params.id, req.userId, patch);
  if (!updated) return res.status(404).json({ error: "Not found" });
  await db.createItemEvent({ itemId: updated.id, userId: req.userId, kind: "updated", detail: Object.keys(patch).join(", ") });
  res.json(updated);
}));

app.delete("/api/items/:id", requireAuth, h(async (req, res) => {
  // Hent item først så vi får chipUid før vi sletter
  const item = await db.getItem(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: "Not found" });
  const ok = await db.deleteItem(req.params.id, req.userId);
  if (!ok) return res.status(404).json({ error: "Not found" });
  // Frigi chipen i registeret så eieren kan bruke den på et annet produkt
  // hvis noen har ombestemt seg — eller støtte som vil nullstille den.
  if (item.chipUid && STRICT_CHIP_REGISTER) {
    try { await db.releaseChip(item.chipUid); } catch {}
  }
  res.json({ ok: true });
}));

// Sett geofence / "hjemme-sone" for en gjenstand. Radius i meter.
// Brukes i sporingsappen: "varsle meg hvis sykkelen min beveger seg mer
// enn 100m fra garasjen". Når pings kommer utenfor sonen får eieren
// en automatisk notifikasjon.
app.post("/api/items/:id/geofence", requireAuth, h(async (req, res) => {
  const { homeLat, homeLng, radiusM } = req.body || {};
  if (homeLat == null && homeLng == null && radiusM == null) {
    // Slett/deaktiver geofence
    const updated = await db.updateItem(req.params.id, req.userId, {
      homeLat: null, homeLng: null, geofenceRadiusM: null, geofenceAlerted: false,
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(updated);
  }
  if (typeof homeLat !== "number" || typeof homeLng !== "number" || typeof radiusM !== "number") {
    return res.status(400).json({ error: "homeLat, homeLng og radiusM (meter) er påkrevd" });
  }
  if (radiusM < 10 || radiusM > 100000) {
    return res.status(400).json({ error: "radiusM må være mellom 10 og 100 000 meter" });
  }
  const updated = await db.updateItem(req.params.id, req.userId, {
    homeLat, homeLng, geofenceRadiusM: Math.round(radiusM), geofenceAlerted: false,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
}));

// Marker som mistet / funnet
app.post("/api/items/:id/lost", requireAuth, h(async (req, res) => {
  const { message } = req.body || {};
  const updated = await db.updateItem(req.params.id, req.userId, {
    status: "missing",
    lostMessage: message || null,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  await db.createItemEvent({ itemId: updated.id, userId: req.userId, kind: "marked_lost", detail: message || null });
  await db.createNotification({
    userId: req.userId,
    kind: "item_lost",
    title: `${updated.name} er markert som mistet`,
    body: "Vi varsler deg hvis noen rapporterer funn via offentlig kode.",
    itemId: updated.id,
  });
  res.json(updated);
}));

app.post("/api/items/:id/found", requireAuth, h(async (req, res) => {
  const updated = await db.updateItem(req.params.id, req.userId, {
    status: "secured",
    lostMessage: null,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  await db.createItemEvent({ itemId: updated.id, userId: req.userId, kind: "marked_found", detail: null });
  res.json(updated);
}));

app.get("/api/items/:id/events", requireAuth, h(async (req, res) => {
  const item = await db.getItem(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: "Not found" });
  const events = await db.listItemEvents(req.params.id, 100);
  res.json(events);
}));

app.get("/api/items/:id/found-reports", requireAuth, h(async (req, res) => {
  const item = await db.getItem(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: "Not found" });
  const reports = await db.listFoundReports(req.params.id);
  res.json(reports);
}));

// ============================================================================
// NOTIFICATIONS
// ============================================================================

app.get("/api/notifications", requireAuth, h(async (req, res) => {
  const list = await db.listNotifications(req.userId, 100);
  res.json(list);
}));

app.get("/api/notifications/unread-count", requireAuth, h(async (req, res) => {
  const count = await db.countUnreadNotifications(req.userId);
  res.json({ count });
}));

app.post("/api/notifications/read-all", requireAuth, h(async (req, res) => {
  await db.markAllNotificationsRead(req.userId);
  res.json({ ok: true });
}));

app.delete("/api/notifications", requireAuth, h(async (req, res) => {
  await db.deleteAllNotifications(req.userId);
  res.json({ ok: true });
}));

// ============================================================================
// STATS
// ============================================================================

app.get("/api/stats", requireAuth, h(async (req, res) => {
  const stats = await db.getUserStats(req.userId);
  res.json(stats);
}));

// ============================================================================
// PUBLIC FOUND FLOW (no auth — accessed via QR/offentlig kode)
// ============================================================================

app.get("/api/found/:code", foundLimiter, h(async (req, res) => {
  const item = await db.findItemByPublicCode(req.params.code);
  if (!item) return res.status(404).json({ error: "Ukjent kode" });
  // Begrenset visning — ikke lekke eierens data
  res.json({
    id: item.id,
    name: item.name,
    category: item.category,
    brand: item.brand,
    color: item.color,
    status: item.status,
    lostMessage: item.lostMessage,
    photoUrl: item.photoUrl,
  });
}));

app.post("/api/found/:code/report", foundLimiter, h(async (req, res) => {
  const item = await db.findItemByPublicCode(req.params.code);
  if (!item) return res.status(404).json({ error: "Ukjent kode" });
  const { finderName, finderContact, message, lat, lng } = req.body || {};
  await db.createFoundReport({
    itemId: item.id,
    finderName,
    finderContact,
    message,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
  });
  // Logg i aktivitetslogg
  const detail = finderName ? `Rapport fra ${finderName}: ${message || ""}` : message || "Funnrapport mottatt";
  await db.createItemEvent({ itemId: item.id, userId: null, kind: "found_report", detail });
  // Automatisk marker som funnet hvis gjenstanden er savnet
  if (item.status === "missing") {
    await db.updateItem(item.id, item.ownerId, { status: "secured", lost_message: null });
    await db.createItemEvent({ itemId: item.id, userId: null, kind: "marked_found", detail: "Automatisk markert som funnet etter funnrapport" });
  }
  await db.createNotification({
    userId: item.ownerId,
    kind: "found_report",
    title: `Noen har rapportert funn av ${item.name}`,
    body: message || "En finder har lagt igjen en melding.",
    itemId: item.id,
  });
  res.json({ ok: true });
}));

// ============================================================================
// FEEDBACK — brukere rapporterer bugs, ønsker eller spørsmål.
// Lagres i databasen og kan senere videresendes til support-mail.
// ============================================================================

const FEEDBACK_INBOX = process.env.FEEDBACK_INBOX || "support@s-tag.no";
const FEEDBACK_FROM = process.env.FEEDBACK_FROM || "S-TAG <onboarding@resend.dev>";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FEEDBACK_KINDS = new Set(["bug", "feature", "question", "other"]);

/**
 * Sender feedback som e-post til FEEDBACK_INBOX via Resend.
 * Hvis RESEND_API_KEY ikke er satt faller vi tilbake til kun logg-linje
 * så pilot-oppsett uten SMTP fortsatt fungerer.
 */
async function sendFeedbackEmail({ kind, subject, message, name, email, userAgent, path, id }) {
  if (!RESEND_API_KEY) {
    console.log(
      `[FEEDBACK → ${FEEDBACK_INBOX}] ${kind.toUpperCase()} · id=${id}` +
        ` · ${name || "anon"} <${email || "ingen-mail"}> · ${subject || "(uten emne)"}` +
        ` · (ingen RESEND_API_KEY — kun logget)`
    );
    return { sent: false, reason: "no_api_key" };
  }

  const escapeHtml = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const kindLabel = {
    bug: "Feil",
    feature: "Forslag",
    question: "Spørsmål",
    other: "Annet",
  }[kind] || "Annet";

  const subjectLine = `[S-TAG · ${kindLabel}] ${subject || "(uten emne)"}`;

  const bodyText = [
    `Type: ${kindLabel}`,
    `Fra: ${name || "Anonym"}${email ? ` <${email}>` : ""}`,
    `Emne: ${subject || "(uten emne)"}`,
    `Sti: ${path || "—"}`,
    `User-Agent: ${userAgent || "—"}`,
    `Feedback-ID: ${id}`,
    "",
    "--- Melding ---",
    message,
  ].join("\n");

  const bodyHtml = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="border-left:4px solid #0f2a5c;padding-left:16px;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Ny melding · ${escapeHtml(kindLabel)}</div>
        <h1 style="font-size:20px;margin:4px 0 0 0;">${escapeHtml(subject || "(uten emne)")}</h1>
      </div>
      <table style="width:100%;font-size:13px;margin-bottom:16px;">
        <tr><td style="color:#64748b;width:90px;">Fra</td><td><strong>${escapeHtml(name || "Anonym")}</strong>${email ? ` &lt;<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>&gt;` : ""}</td></tr>
        <tr><td style="color:#64748b;">Sti</td><td>${escapeHtml(path || "—")}</td></tr>
        <tr><td style="color:#64748b;">Enhet</td><td style="font-size:11px;color:#475569;">${escapeHtml(userAgent || "—")}</td></tr>
        <tr><td style="color:#64748b;">ID</td><td style="font-family:monospace;font-size:11px;">${escapeHtml(String(id))}</td></tr>
      </table>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;white-space:pre-wrap;font-size:14px;line-height:1.6;">
        ${escapeHtml(message)}
      </div>
      <p style="margin-top:24px;font-size:11px;color:#94a3b8;">Sendt automatisk fra S-TAG feedback-skjema.</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: [FEEDBACK_INBOX],
        reply_to: email || undefined,
        subject: subjectLine,
        text: bodyText,
        html: bodyHtml,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[FEEDBACK-MAIL] Resend ${res.status}: ${errText}`);
      return { sent: false, reason: `resend_${res.status}` };
    }
    console.log(`[FEEDBACK-MAIL] Sendt id=${id} → ${FEEDBACK_INBOX}`);
    return { sent: true };
  } catch (err) {
    console.error("[FEEDBACK-MAIL] Feil:", err.message);
    return { sent: false, reason: "exception" };
  }
}

function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (payload && payload.userId) req.userId = payload.userId;
  next();
}

app.post("/api/feedback", feedbackLimiter, optionalAuth, h(async (req, res) => {
  const body = req.body || {};
  const message = String(body.message || "").trim();
  if (!message) return res.status(400).json({ error: "Melding er påkrevd" });
  if (message.length > 4000) {
    return res.status(400).json({ error: "Meldingen er for lang (maks 4000 tegn)" });
  }

  let name = body.name ? String(body.name).trim() : null;
  let email = body.email ? String(body.email).trim().toLowerCase() : null;

  // Hvis innlogget, bruk kontodata som fallback
  if (req.userId) {
    const me = await db.findUserById(req.userId);
    if (me) {
      name = name || me.name;
      email = email || me.email;
    }
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Ugyldig e-postadresse" });
  }

  const kind = FEEDBACK_KINDS.has(body.kind) ? body.kind : "other";
  const subject = body.subject ? String(body.subject).trim().slice(0, 200) : null;
  const userAgent = req.headers["user-agent"] || null;
  const path = body.path ? String(body.path).slice(0, 200) : null;

  const saved = await db.createFeedback({
    userId: req.userId || null,
    name,
    email,
    kind,
    subject,
    message,
    userAgent,
    path,
  });

  // Send e-post til support-inbox. Feiler lydløst — meldingen er lagret i DB uansett.
  sendFeedbackEmail({
    id: saved.id,
    kind,
    subject,
    message,
    name,
    email,
    userAgent,
    path,
  }).catch((err) => console.error("[FEEDBACK-MAIL] Uventet:", err));

  res.status(201).json({ ok: true, id: saved.id });
}));

// Admin: list feedback (krever innlogget bruker med admin-flag i e-posten)
app.get("/api/feedback", requireAuth, h(async (req, res) => {
  const me = await db.findUserById(req.userId);
  if (!me || me.email !== FEEDBACK_INBOX) {
    return res.status(403).json({ error: "Kun administrator" });
  }
  const list = await db.listFeedback(Number(req.query.limit) || 100);
  res.json(list);
}));

// ============================================================================
// CHIP (NFC/BLE) — klar for hardware-integrasjon
// ============================================================================

app.post("/api/chip/pair", requireAuth, h(async (req, res) => {
  const { itemId } = req.body || {};
  const chipUid = String(req.body?.chipUid || "").trim().toUpperCase();
  if (!itemId || !chipUid) return res.status(400).json({ error: "itemId og chipUid er påkrevd" });
  if (!/^[A-Z0-9-]{6,64}$/.test(chipUid)) {
    return res.status(400).json({ error: "Ugyldig chip-ID" });
  }
  const item = await db.getItem(itemId, req.userId);
  if (!item) return res.status(404).json({ error: "Gjenstand ikke funnet" });
  if (item.chipUid === chipUid) return res.json(item);

  const conflict = await db.findItemByChipUid(chipUid);
  if (conflict) {
    return res.status(409).json({ error: "Denne chippen er allerede paret med en annen gjenstand" });
  }

  // Samme whitelist-regler som ved registrering i /api/items
  if (STRICT_CHIP_REGISTER) {
    const claim = await db.claimChip(chipUid, req.userId, item.id);
    if (!claim.ok) {
      const msg = {
        not_in_register: "Ukjent S-TAG-kode",
        disabled: "Denne S-TAG-chipen er deaktivert. Kontakt support.",
        already_claimed: "Denne S-TAG-chipen er allerede registrert på en annen konto.",
      }[claim.reason] || "Kunne ikke reservere S-TAG-chipen";
      return res.status(409).json({ error: msg });
    }
  }

  const previousUid = item.chipUid;
  const updated = await db.pairChip(item.id, req.userId, chipUid);
  if (previousUid && STRICT_CHIP_REGISTER) {
    try { await db.releaseChip(previousUid); } catch {}
  }
  await db.createItemEvent({ itemId: item.id, userId: req.userId, kind: "chip_paired", detail: chipUid });
  res.json(updated);
}));

app.post("/api/chip/unpair", requireAuth, h(async (req, res) => {
  const { itemId } = req.body || {};
  const item = await db.getItem(itemId, req.userId);
  if (!item) return res.status(404).json({ error: "Gjenstand ikke funnet" });
  const updated = await db.unpairChip(item.id, req.userId);
  if (item.chipUid && STRICT_CHIP_REGISTER) {
    try { await db.releaseChip(item.chipUid); } catch {}
  }
  await db.createItemEvent({ itemId: item.id, userId: req.userId, kind: "chip_unpaired", detail: item.chipUid });
  res.json(updated);
}));

// Chip ping — kalles av fysisk chip / gateway.
//
// Autentisering: HMAC-SHA256 over payloaden `chipUid:timestamp:nonce`.
// Hver chip har sin EGEN hmac_secret (lagret i chips-tabellen + brent inn
// i chipens flash-minne ved produksjon). En kompromittert chip lar derfor
// ikke angriper forfalske posisjon på andre chiper.
//
// Fallback: hvis chipen ikke har per-chip secret (eldre hardware eller
// dev-mode), faller vi tilbake på global CHIP_HMAC_SECRET. Lokalt uten
// noen secret tillates ping uten signatur for utvikler-ergonomi.
//
// Chipen/gateway sender headers:
//   X-Chip-Timestamp: <unix ms>
//   X-Chip-Nonce:     <uuid / random 16 bytes>
//   X-Chip-Signature: <base64url HMAC-SHA256>
const CHIP_HMAC_SECRET = process.env.CHIP_HMAC_SECRET || "";
const chipNonceCache = new Map(); // nonce → expiry (replay-beskyttelse)

function computeChipSignature(secret, chipUid, ts, nonce) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${chipUid}:${ts}:${nonce}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function verifyChipSignature(req) {
  const chipUid = String((req.body && req.body.chipUid) || "").trim().toUpperCase();
  if (!chipUid) return { ok: false, reason: "missing_chip_uid" };

  const ts    = Number(req.headers["x-chip-timestamp"] || 0);
  const nonce = String(req.headers["x-chip-nonce"] || "");
  const sig   = String(req.headers["x-chip-signature"] || "");

  // Ingen signatur — tillat KUN i dev uten noen secret konfigurert
  if (!ts && !nonce && !sig) {
    if (!CHIP_HMAC_SECRET && !IS_PRODUCTION) return { ok: true, reason: "dev_mode" };
    return { ok: false, reason: "missing_signature" };
  }
  if (!ts || !nonce || !sig) return { ok: false, reason: "incomplete_signature" };

  // Maks 5 minutter drift mellom gateway og server
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return { ok: false, reason: "timestamp_drift" };

  // Replay-beskyttelse: avvis gjenbrukte nonces innen vinduet
  const now = Date.now();
  for (const [k, exp] of chipNonceCache) if (exp < now) chipNonceCache.delete(k);
  if (chipNonceCache.has(nonce)) return { ok: false, reason: "nonce_replay" };

  // Hent chip fra registeret (inkludert secret) for per-chip nøkkel
  const chip = await db.getChipByUid(chipUid, { includeSecret: true });
  const perChipSecret = chip && chip.hmacSecret;

  // Prøv per-chip secret først, så global fallback
  const candidates = [];
  if (perChipSecret) candidates.push(perChipSecret);
  if (CHIP_HMAC_SECRET) candidates.push(CHIP_HMAC_SECRET);
  if (candidates.length === 0) {
    // Dev-mode: ingen secrets finnes i det hele tatt
    if (!IS_PRODUCTION) return { ok: true, reason: "dev_mode" };
    return { ok: false, reason: "no_secret_configured" };
  }

  const sigBuf = Buffer.from(sig);
  for (const secret of candidates) {
    const expected = computeChipSignature(secret, chipUid, ts, nonce);
    let matches = false;
    try {
      const expectedBuf = Buffer.from(expected);
      matches = sigBuf.length === expectedBuf.length &&
                crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      matches = false;
    }
    if (matches) {
      chipNonceCache.set(nonce, now + 10 * 60 * 1000);
      return { ok: true, reason: "verified", chip };
    }
  }
  return { ok: false, reason: "invalid_signature" };
}

app.post("/api/chip/ping", chipPingLimiter, h(async (req, res) => {
  const verify = await verifyChipSignature(req);
  if (!verify.ok) {
    return res.status(401).json({ error: "Ugyldig chip-signatur", reason: verify.reason });
  }

  const {
    chipUid: rawUid,
    lat, lng, battery,
    accuracyM, altitudeM, speedMps, headingDeg,
    temperatureC, motion, rssi, firmwareVersion, source,
  } = req.body || {};
  const chipUid = String(rawUid || "").trim().toUpperCase();
  if (!chipUid) return res.status(400).json({ error: "chipUid required" });

  // Grunnleggende validering på rike telemetridata
  if (lat != null && (typeof lat !== "number" || lat < -90 || lat > 90)) {
    return res.status(400).json({ error: "Ugyldig lat" });
  }
  if (lng != null && (typeof lng !== "number" || lng < -180 || lng > 180)) {
    return res.status(400).json({ error: "Ugyldig lng" });
  }
  if (battery != null && (typeof battery !== "number" || battery < 0 || battery > 100)) {
    return res.status(400).json({ error: "Ugyldig battery (0-100)" });
  }

  const telemetry = {
    chipUid, lat, lng, battery,
    accuracyM, altitudeM, speedMps, headingDeg,
    temperatureC, motion, rssi, firmwareVersion, source,
  };

  const item = await db.findItemByChipUid(chipUid);
  if (!item) {
    // Pingen logges fortsatt for statistikk, men chipen har ikke en eier enda.
    // Dette er normalt for nye produkter som sitter i butikkhylla — chipen
    // kan godt pinge før noen registrerer den i appen.
    await Promise.all([
      db.recordChipPing({ ...telemetry, matched: false }),
      db.markChipPinged(chipUid, { firmwareVersion }),
    ]);
    return res.status(202).json({ ok: true, status: "unclaimed" });
  }

  // Kjør alle 3 DB-operasjoner parallelt — de er uavhengige av hverandre.
  await Promise.all([
    db.updateItemFromPing(chipUid, { lat, lng, battery, accuracyM, speedMps, temperatureC }),
    db.recordChipPing({ ...telemetry, matched: true }),
    db.markChipPinged(chipUid, { firmwareVersion }),
  ]);

  // Geofence-sjekk: hvis chipen er utenfor "hjemme-sonen" og eieren
  // ikke allerede har fått varsel, send et notification.
  if (typeof lat === "number" && typeof lng === "number") {
    try {
      const geo = await db.checkGeofence(item.id, lat, lng);
      if (geo && geo.exceeded && !geo.alreadyAlerted) {
        await db.createNotification({
          userId: item.ownerId,
          kind: "geofence_exit",
          title: `${item.name} har forlatt sikker sone`,
          body: `Bevegelse oppdaget ${Math.round(geo.distanceM)} m fra hjemposisjon (grense ${geo.radiusM} m).`,
          itemId: item.id,
        });
        await db.markGeofenceAlerted(item.id, true);
      } else if (geo && !geo.exceeded && geo.alreadyAlerted) {
        // Tilbake i sone — nullstill så neste brudd kan varsle på nytt
        await db.markGeofenceAlerted(item.id, false);
      }
    } catch (err) {
      // geofence er "best effort" — ikke la feil her blokkere ping
      console.error("geofence check failed:", err.message);
    }
  }

  res.json({
    ok: true,
    status: item.status === "missing" ? "lost_mode" : "normal",
    // Chipen kan bruke dette til å justere ping-frekvens.
    // Normalt: ping hvert 60. minutt. Mistet: hvert 1. minutt.
    nextPingSeconds: item.status === "missing" ? 60 : 3600,
  });
}));

// Chip henter egen konfigurasjon ved oppstart (eller periodisk).
// Sender tilbake ping-intervall og lost-mode-status. IKKE autentisert med
// chip-signatur — dette er en read-only GET som kun returnerer offentlig
// informasjon basert på UID. Krever at UID finnes i registeret.
app.get("/api/chip/:uid/config", h(async (req, res) => {
  const uid = String(req.params.uid || "").trim().toUpperCase();
  const chip = await db.getChipByUid(uid);
  if (!chip) return res.status(404).json({ error: "Ukjent chip" });
  if (chip.status === "disabled") {
    return res.status(410).json({ error: "Chip deaktivert", action: "halt" });
  }

  // Hvis chipen er claimed: slå opp eier-item for å finne lost-mode-status.
  let lostMode = false;
  if (chip.status === "claimed" && chip.itemId) {
    const item = await db.findItemByChipUid(uid);
    lostMode = item?.status === "missing";
  }

  res.json({
    uid: chip.uid,
    claimed: chip.status === "claimed",
    lostMode,
    // Konfigurasjon chipen kan følge
    config: {
      // Normal modus: ping hver time
      pingIntervalSec: lostMode ? 60 : 3600,
      // Ekstra sparing når chipen ikke er registrert av en bruker enda
      unclaimedIntervalSec: chip.status === "claimed" ? null : 86400, // 1 gang pr. dag
      // Antall forsøk før back-off
      maxRetries: 3,
      // Krav om signatur? Produksjon = alltid, dev = valgfritt
      requireSignature: IS_PRODUCTION,
    },
  });
}));

// ============================================================================
// ADMIN — CHIP REGISTER
// ============================================================================
// Her legger admin inn de fysisk produserte chipene FØR de sendes til
// produsenten som støper dem inn i produktene. Alle endepunkter krever
// ADMIN_TOKEN (header: Authorization: Bearer <token>).
//
// Normal arbeidsflyt:
//   1. Produksjonspartneren sender deg en liste (CSV/Excel) over UID-ene
//      de skal produsere.
//   2. Du importerer listen via POST /api/admin/chips/bulk (eller med
//      scripts/import-chips.js <fil.csv>).
//   3. Chipene støpes inn i produktene og sendes ut.
//   4. Når kunden kjøper produktet og registrerer det i appen, går
//      flyten via /api/items som sjekker at UID-en finnes i registeret
//      og "claimer" den på brukerens konto.
//
// S-TAG aksepterer da KUN chiper som står i dette registeret — ingen kan
// gjette en kode eller registrere noe som ikke er produsert av oss.

// Oversikt over alle chiper i registeret. Støtter filter på status/batch.
app.get("/api/admin/chips", requireAdmin, h(async (req, res) => {
  const limit  = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;
  const status = req.query.status ? String(req.query.status) : undefined;
  const batch  = req.query.batch  ? String(req.query.batch)  : undefined;
  const manufacturer = req.query.manufacturer ? String(req.query.manufacturer) : undefined;
  const chips = await db.listChips({ status, batch, manufacturer, limit, offset });
  res.json(chips);
}));

// Statistikk — hvor mange chiper er i registeret, hvor mange er claimed osv.
app.get("/api/admin/chips/stats", requireAdmin, h(async (_req, res) => {
  const stats = await db.countChips();
  res.json(stats);
}));

// Slå opp én chip
app.get("/api/admin/chips/:uid", requireAdmin, h(async (req, res) => {
  const chip = await db.getChipByUid(String(req.params.uid).trim().toUpperCase());
  if (!chip) return res.status(404).json({ error: "Ukjent chip" });
  res.json(chip);
}));

// Legg inn én chip manuelt. Returnerer chipen INKLUDERT den genererte
// hmacSecret. Dette er det eneste tidspunktet secret-en eksponeres —
// produksjonslinjen må lagre den i chipens flash-minne her. Etter dette
// er den aldri tilgjengelig via API igjen.
app.post("/api/admin/chips", requireAdmin, h(async (req, res) => {
  const { uid, manufacturer, batch, productType, hardwareRev, firmwareVersion, hmacSecret, note } = req.body || {};
  if (!uid || !String(uid).trim()) {
    return res.status(400).json({ error: "uid er påkrevd" });
  }
  const chip = await db.createChip({
    uid, manufacturer, batch, productType, hardwareRev, firmwareVersion, hmacSecret, note,
  });
  if (!chip) return res.status(409).json({ error: "Chip finnes allerede i registeret" });
  res.status(201).json(chip);
}));

// Bulk-import. Body: { chips: [{ uid, manufacturer?, batch?, productType?, note? }, ...] }
// Brukes av scripts/import-chips.js og produksjonssystemet.
app.post("/api/admin/chips/bulk", requireAdmin, h(async (req, res) => {
  const body = req.body || {};
  const rows = Array.isArray(body.chips) ? body.chips : null;
  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: "chips[] er påkrevd" });
  }
  if (rows.length > 10000) {
    return res.status(413).json({ error: "Maks 10 000 chips pr. request" });
  }
  const result = await db.bulkCreateChips(rows);
  res.status(201).json(result);
}));

// Frigi en chip (f.eks. hvis feilregistrert). ADVARSEL: vil IKKE slette
// gjenstanden brukeren har opprettet — kun løsrive den fra registeret.
// Bruk /api/admin/chips/:uid med DELETE for å fjerne den helt fra registeret.
app.post("/api/admin/chips/:uid/release", requireAdmin, h(async (req, res) => {
  const chip = await db.releaseChip(String(req.params.uid).trim().toUpperCase());
  if (!chip) return res.status(404).json({ error: "Ukjent chip" });
  res.json(chip);
}));

// ============================================================================
// TRANSFERS (Eierskifte)
// ============================================================================

app.get("/api/transfers", requireAuth, h(async (req, res) => {
  const me = await db.findUserById(req.userId);
  const list = await db.listTransfersForUser(req.userId, me?.email);
  res.json(list);
}));

const CONTRACT_VERSION = process.env.CONTRACT_VERSION || "2026-04";

app.post("/api/transfers", requireAuth, h(async (req, res) => {
  const {
    itemId,
    toEmail,
    note,
    salePriceNok,
    conditionNote,
    paymentMethod,
    asIs,
    confirmContract,
  } = req.body || {};

  const item = await db.getItem(itemId, req.userId);
  if (!item) return res.status(404).json({ error: "Gjenstand ikke funnet" });

  const emailNorm = String(toEmail || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    return res.status(400).json({ error: "Ugyldig e-post til kjøper" });
  }

  // Kjøpsloven krever identifiserbare parter, ting og pris for et gyldig kjøp.
  if (salePriceNok === undefined || salePriceNok === null || Number.isNaN(Number(salePriceNok))) {
    return res.status(400).json({ error: "Pris (NOK) er påkrevd for en gyldig salgskontrakt" });
  }
  const price = Math.max(0, Math.round(Number(salePriceNok)));

  if (!confirmContract) {
    return res.status(400).json({
      error: "Du må bekrefte salgskontrakten for å opprette eierskifte",
    });
  }

  const seller = await db.findUserById(req.userId);
  if (!seller) return res.status(404).json({ error: "Bruker ikke funnet" });
  if (emailNorm === seller.email) {
    return res.status(400).json({ error: "Du kan ikke overføre en gjenstand til deg selv" });
  }
  if (await db.findPendingTransferForItem(item.id)) {
    return res.status(409).json({
      error: "Det finnes allerede et ventende eierskifte for denne gjenstanden.",
    });
  }

  const transfer = {
    id: crypto.randomUUID(),
    itemId,
    itemName: item.name,
    fromUserId: req.userId,
    toEmail: emailNorm,
    note: note || "",
    status: "pending",
    createdAt: new Date().toISOString(),
    salePriceNok: price,
    conditionNote: conditionNote ? String(conditionNote).slice(0, 2000) : null,
    sellerName: seller.name,
    buyerName: null,
    paymentMethod: paymentMethod ? String(paymentMethod).slice(0, 120) : null,
    asIs: asIs !== false,
    sellerConfirmedAt: new Date().toISOString(),
    contractVersion: CONTRACT_VERSION,
  };
  // Frys kontraktsteksten ved opprettelse — begge parter skal signere
  // NØYAKTIG samme tekst, uavhengig av endringer i koden senere. Dette er
  // beviset under eForvaltningsforskriften §27 / eIDAS art. 25 når BankID
  // signaturen returneres som JWT.
  transfer.contractText = buildContractText(transfer, item, "seller");
  const saved = await db.createTransfer(transfer);
  res.status(201).json(saved);
}));

app.post("/api/transfers/:id/accept", requireAuth, h(async (req, res) => {
  const transfer = await db.getTransfer(req.params.id);
  if (!transfer) return res.status(404).json({ error: "Ikke funnet" });
  const user = await db.findUserById(req.userId);
  if (!user || user.email !== transfer.toEmail) {
    return res.status(403).json({ error: "Ikke mottaker" });
  }
  if (transfer.status !== "pending") {
    return res.status(409).json({ error: "Eierskiftet er ikke aktivt" });
  }
  if (req.body?.confirmContract !== true) {
    return res.status(400).json({
      error:
        "Du må lese salgskontrakten og bekrefte kjøpet for å overta eierskapet",
    });
  }
  const buyerName = req.body?.buyerName ? String(req.body.buyerName).trim() : user.name;
  const accepted = await db.acceptTransfer(req.params.id, req.userId, buyerName);
  res.json(accepted);
}));

// ============================================================================
// BankID-signering via Criipto Verify
// ============================================================================

const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN || ""; // f.eks. "s-tag.criipto.id"
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID || "";
const CRIIPTO_CLIENT_SECRET = process.env.CRIIPTO_CLIENT_SECRET || "";
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (IS_PRODUCTION ? "https://s-tag-ten.vercel.app" : "http://localhost:3000");
const SIGNING_CALLBACK_PATH = "/eierskifte/signatur-callback";

function criiptoConfigured() {
  return !!(CRIIPTO_DOMAIN && CRIIPTO_CLIENT_ID && CRIIPTO_CLIENT_SECRET);
}

// Kortlevd in-memory state → knytter callback til transfer + rolle.
const signingSessions = new Map();
function cleanupSigningSessions() {
  const now = Date.now();
  for (const [k, v] of signingSessions) {
    if (now - v.createdAt > 20 * 60 * 1000) signingSessions.delete(k);
  }
}

function buildContractText(transfer, item, role) {
  const lines = [
    `Salgskontrakt · S-TAG versjon ${transfer.contractVersion || "2026-04"}`,
    ``,
    `Rolle: ${role === "seller" ? "Selger" : "Kjøper"}`,
    `Gjenstand: ${item?.name || transfer.itemName}`,
    item?.brand && `Merke: ${item.brand}`,
    item?.model && `Modell: ${item.model}`,
    item?.serialNumber && `Serienummer: ${item.serialNumber}`,
    item?.chipUid && `S-TAG chip-ID: ${item.chipUid}`,
    ``,
    `Selger: ${transfer.sellerName || "—"}`,
    `Kjøper (e-post): ${transfer.toEmail}`,
    `Avtalt pris: ${transfer.salePriceNok} NOK`,
    transfer.paymentMethod && `Betaling: ${transfer.paymentMethod}`,
    transfer.conditionNote && `Tilstand: ${transfer.conditionNote}`,
    `Selges «som den er»: ${transfer.asIs ? "Ja" : "Nei"}`,
    ``,
    `Ved å signere med BankID bekrefter jeg å ha lest og godtatt kontrakten.`,
  ].filter(Boolean);
  return lines.join("\n");
}

app.get("/api/signing/bankid/status", (_req, res) => {
  res.json({ configured: criiptoConfigured() });
});

app.post("/api/signing/bankid/start", requireAuth, h(async (req, res) => {
  if (!criiptoConfigured()) {
    return res.status(501).json({
      error:
        "BankID-signering er ikke konfigurert. Sett CRIIPTO_DOMAIN, CRIIPTO_CLIENT_ID og CRIIPTO_CLIENT_SECRET.",
    });
  }
  const { transferId, role } = req.body || {};
  if (!transferId || !["seller", "buyer"].includes(role)) {
    return res.status(400).json({ error: "transferId og rolle (seller|buyer) er påkrevd" });
  }
  const transfer = await db.getTransfer(transferId);
  if (!transfer) return res.status(404).json({ error: "Eierskifte ikke funnet" });

  const user = await db.findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Bruker ikke funnet" });

  if (role === "seller" && transfer.fromUserId !== req.userId) {
    return res.status(403).json({ error: "Bare selger kan signere som selger" });
  }
  if (role === "buyer" && user.email !== transfer.toEmail) {
    return res.status(403).json({ error: "Bare kjøper kan signere som kjøper" });
  }

  const item = await db.getItem(transfer.itemId, transfer.fromUserId);
  // Bruk den frosne kontraktsteksten fra transfer-raden hvis tilgjengelig.
  // Fall tilbake til buildContractText kun for eldre rader som ble opprettet
  // før contract_text-kolonnen ble tatt i bruk.
  const contractText =
    transfer.contractText && transfer.contractText.length > 0
      ? transfer.contractText
      : buildContractText(transfer, item, role);
  const messageB64 = Buffer.from(contractText, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 4000);

  const state = crypto.randomBytes(16).toString("hex");
  signingSessions.set(state, {
    transferId,
    role,
    userId: req.userId,
    createdAt: Date.now(),
  });
  cleanupSigningSessions();

  const redirectUri = `${APP_BASE_URL}${SIGNING_CALLBACK_PATH}`;
  const authUrl = new URL(`https://${CRIIPTO_DOMAIN}/oauth2/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CRIIPTO_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid");
  authUrl.searchParams.set("acr_values", "urn:grn:authn:no:bankid");
  authUrl.searchParams.set("login_hint", `action:sign message:${messageB64}`);
  authUrl.searchParams.set("state", state);

  res.json({ authUrl: authUrl.toString() });
}));

app.post("/api/signing/bankid/callback", requireAuth, h(async (req, res) => {
  if (!criiptoConfigured()) {
    return res.status(501).json({ error: "BankID-signering er ikke konfigurert" });
  }
  const { code, state } = req.body || {};
  if (!code || !state) return res.status(400).json({ error: "code og state er påkrevd" });

  const sess = signingSessions.get(state);
  if (!sess) return res.status(400).json({ error: "Ukjent eller utløpt signatur-session" });
  if (sess.userId !== req.userId) {
    return res.status(403).json({ error: "Signatur-session tilhører en annen bruker" });
  }
  signingSessions.delete(state);

  const redirectUri = `${APP_BASE_URL}${SIGNING_CALLBACK_PATH}`;
  const tokenRes = await fetch(`https://${CRIIPTO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: redirectUri,
      client_id: CRIIPTO_CLIENT_ID,
      client_secret: CRIIPTO_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    return res.status(502).json({ error: `Criipto token-bytte feilet: ${body}` });
  }
  const tokenData = await tokenRes.json();
  const idToken = tokenData.id_token;
  if (!idToken) return res.status(502).json({ error: "Mangler id_token fra Criipto" });

  let claims;
  try {
    claims = await verifyIdToken(idToken, {
      jwksUrl: `https://${CRIIPTO_DOMAIN}/.well-known/jwks`,
      issuers: [`https://${CRIIPTO_DOMAIN}`],
      audience: CRIIPTO_CLIENT_ID,
    });
  } catch (err) {
    return res.status(401).json({ error: `Kunne ikke verifisere signatur: ${err.message}` });
  }

  const signerName =
    claims.name ||
    [claims.given_name, claims.family_name].filter(Boolean).join(" ") ||
    null;

  const updated = await db.setTransferSignature(sess.transferId, sess.role, {
    jwt: idToken,
    sub: claims.sub || null,
    name: signerName,
    signedAt: new Date().toISOString(),
  });

  res.json({
    ok: true,
    transferId: sess.transferId,
    role: sess.role,
    signerName,
    transfer: updated,
  });
}));

// ============================================================================
// Error handler
// ============================================================================

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

// --- Startup with cluster mode ---
const cluster = require("cluster");

// Antall workers: bruk WORKERS env-var eller antall CPU-kjerner (maks 4 i prod for å spare RAM)
const WORKERS = parseInt(process.env.WORKERS, 10) || Math.min(os.cpus().length, 4);

if (cluster.isPrimary && WORKERS > 1 && process.env.NODE_ENV === "production") {
  console.log(`S-TAG primary ${process.pid}: spawning ${WORKERS} workers`);

  for (let i = 0; i < WORKERS; i++) cluster.fork();

  cluster.on("exit", (worker, code) => {
    console.error(`Worker ${worker.process.pid} died (code ${code}), restarting...`);
    cluster.fork();
  });
} else {
  (async () => {
    try {
      await db.initSchema();
    } catch (err) {
      console.error("Schema init failed:", err.message);
      if (db.USE_PG) process.exit(1);
    }
    app.listen(PORT, () => {
      const mode = WORKERS > 1 && process.env.NODE_ENV === "production" ? `cluster (worker ${process.pid})` : "single";
      console.log(`S-TAG backend [${mode}] on http://localhost:${PORT} (store: ${db.USE_PG ? "postgres" : "json"})`);
    });

    // Periodisk opprydding av gamle chip_pings (kun i én worker / single mode).
    // Kjøres daglig. Beholder siste ping per chip uansett alder.
    const isPrimaryWorker = !cluster.isWorker || cluster.worker.id === 1;
    if (isPrimaryWorker && db.USE_PG) {
      const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 timer
      async function runCleanup() {
        try {
          const deleted = await db.cleanupOldPings();
          if (deleted > 0) console.log(`Cleanup: slettet ${deleted} gamle chip_pings`);
        } catch (err) {
          console.error("Cleanup feilet:", err.message);
        }
      }
      // Første kjøring 5 min etter oppstart, deretter daglig
      setTimeout(runCleanup, 5 * 60 * 1000);
      setInterval(runCleanup, CLEANUP_INTERVAL_MS);
    }
  })();
}
