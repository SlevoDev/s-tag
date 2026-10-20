/**
 * S-TAG datastore
 *
 * Bruker Postgres (via DATABASE_URL) i produksjon, JSON-fil lokalt.
 * Eksponerer ett async API så server.js slipper å bry seg om backend.
 *
 * Alle async funksjoner returnerer samme struktur som det gamle JSON-laget.
 * Snake_case i DB → camelCase i API (mapItem / mapUser / mapTransfer).
 */
const fs = require("fs");
const path = require("path");

const DATABASE_URL = process.env.DATABASE_URL;
const USE_PG = !!DATABASE_URL;

// ============================================================================
// Postgres implementation
// ============================================================================
let pool;
if (USE_PG) {
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: DATABASE_URL,
    // Railway/Supabase krever SSL i prod. Lokal Postgres har det ikke.
    ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    // Skalering: hold nok connections for concurrent requests uten å overbelaste Postgres.
    max: parseInt(process.env.PG_POOL_MAX, 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", (err) => console.error("pg pool error:", err));
}

async function initSchema() {
  if (!USE_PG) return;
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("✓ Postgres schema ready");
}

// --- Row mappers (snake_case → camelCase) ---
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    plan: row.plan,
    createdAt: row.created_at,
    phone: row.phone ?? null,
    address: row.address ?? null,
    postalCode: row.postal_code ?? null,
    city: row.city ?? null,
    avatarUrl: row.avatar_url ?? null,
    insuranceCompany: row.insurance_company ?? null,
    insurancePolicy: row.insurance_policy ?? null,
    notifyEmail: row.notify_email ?? true,
    notifyPush: row.notify_push ?? true,
    notifyMarketing: row.notify_marketing ?? false,
    consentPrivacy: row.consent_privacy ?? false,
    consentLocation: row.consent_location ?? false,
    consentVersion: row.consent_version ?? null,
    consentTerms: row.consent_terms ?? false,
    consentAcceptedAt: row.consent_accepted_at ?? null,
    language: row.language ?? "nb",
    lastSeenAt: row.last_seen_at ?? null,
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    tagId: row.tag_id,
    status: row.status,
    category: row.category,
    chipUid: row.chip_uid,
    chipPairedAt: row.chip_paired_at,
    chipLastPing: row.chip_last_ping,
    chipStatus: row.chip_status,
    lat: row.lat,
    lng: row.lng,
    lastSeen: row.last_seen,
    battery: row.battery,
    createdAt: row.created_at,
    description: row.description ?? null,
    serialNumber: row.serial_number ?? null,
    brand: row.brand ?? null,
    model: row.model ?? null,
    color: row.color ?? null,
    valueNok: row.value_nok ?? null,
    purchasedAt: row.purchased_at ?? null,
    photoUrl: row.photo_url ?? null,
    publicCode: row.public_code ?? null,
    lostMessage: row.lost_message ?? null,
    receiptUrl: row.receipt_url ?? null,
    homeLat: row.home_lat ?? null,
    homeLng: row.home_lng ?? null,
    geofenceRadiusM: row.geofence_radius_m ?? null,
    geofenceAlerted: row.geofence_alerted ?? false,
    accuracyM: row.accuracy_m ?? null,
    speedMps: row.speed_mps ?? null,
    temperatureC: row.temperature_c ?? null,
  };
}

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    itemId: row.item_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    kind: row.kind,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function mapTransfer(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    fromUserId: row.from_user_id,
    toEmail: row.to_email,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    salePriceNok: row.sale_price_nok ?? null,
    conditionNote: row.condition_note ?? null,
    sellerName: row.seller_name ?? null,
    buyerName: row.buyer_name ?? null,
    paymentMethod: row.payment_method ?? null,
    asIs: row.as_is ?? true,
    sellerConfirmedAt: row.seller_confirmed_at ?? null,
    buyerConfirmedAt: row.buyer_confirmed_at ?? null,
    contractVersion: row.contract_version ?? null,
    contractText: row.contract_text ?? null,
    sellerSignatureJwt: row.seller_signature_jwt ?? null,
    sellerSignatureSub: row.seller_signature_sub ?? null,
    sellerSignatureName: row.seller_signature_name ?? null,
    sellerSignedAt: row.seller_signed_at ?? null,
    buyerSignatureJwt: row.buyer_signature_jwt ?? null,
    buyerSignatureSub: row.buyer_signature_sub ?? null,
    buyerSignatureName: row.buyer_signature_name ?? null,
    buyerSignedAt: row.buyer_signed_at ?? null,
  };
}

// ============================================================================
// JSON-fallback (kun lokal dev hvis DATABASE_URL ikke er satt)
// ============================================================================
const DATA_FILE = path.join(__dirname, "data.json");
function jsonLoad() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ users: [], items: [], transfers: [], chipPings: [], chips: [] }, null, 2)
    );
  }
  const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  d.users ||= [];
  d.items ||= [];
  d.transfers ||= [];
  d.chipPings ||= [];
  d.chips ||= [];
  return d;
}
function jsonSave(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ============================================================================
// Public API
// ============================================================================

// ----- USERS -----
async function createUser(user) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO users (
         id, email, name, password_hash, plan,
         consent_terms, consent_privacy, consent_version, consent_accepted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        user.id,
        user.email,
        user.name,
        user.passwordHash,
        user.plan || "free",
        !!user.consentTerms,
        !!user.consentPrivacy,
        user.consentVersion || null,
        user.consentAcceptedAt || null,
      ]
    );
    return mapUser(r.rows[0]);
  }
  const d = jsonLoad();
  d.users.push(user);
  jsonSave(d);
  return user;
}

async function findUserByEmail(email) {
  if (USE_PG) {
    const r = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return mapUser(r.rows[0]);
  }
  const d = jsonLoad();
  return d.users.find((u) => u.email === email) || null;
}

async function findUserById(id) {
  if (USE_PG) {
    const r = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return mapUser(r.rows[0]);
  }
  const d = jsonLoad();
  return d.users.find((u) => u.id === id) || null;
}

// ----- ITEMS -----
async function listItemsByOwner(ownerId) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM items WHERE owner_id = $1 ORDER BY created_at DESC`,
      [ownerId]
    );
    return r.rows.map(mapItem);
  }
  const d = jsonLoad();
  return d.items.filter((i) => i.ownerId === ownerId);
}

async function getItem(id, ownerId) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM items WHERE id = $1 AND owner_id = $2`,
      [id, ownerId]
    );
    return mapItem(r.rows[0]);
  }
  const d = jsonLoad();
  return d.items.find((i) => i.id === id && i.ownerId === ownerId) || null;
}

async function createItem(item) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO items
       (id, owner_id, name, tag_id, status, category, chip_uid, chip_paired_at,
        chip_last_ping, chip_status, lat, lng, last_seen, battery,
        description, serial_number, brand, model, color, value_nok, purchased_at,
        photo_url, public_code, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               $15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        item.id, item.ownerId, item.name, item.tagId, item.status || "secured",
        item.category || "other", item.chipUid, item.chipPairedAt,
        item.chipLastPing, item.chipStatus || "unpaired",
        item.lat ?? 59.9139, item.lng ?? 10.7522,
        item.lastSeen || "Registrert nettopp", item.battery ?? null,
        item.description ?? null, item.serialNumber ?? null,
        item.brand ?? null, item.model ?? null, item.color ?? null,
        item.valueNok ?? null, item.purchasedAt ?? null,
        item.photoUrl ?? null, item.publicCode ?? null,
        item.receiptUrl ?? null,
      ]
    );
    return mapItem(r.rows[0]);
  }
  const d = jsonLoad();
  d.items.push(item);
  jsonSave(d);
  return item;
}

async function updateItem(id, ownerId, patch) {
  if (USE_PG) {
    // Whitelist felter som kan endres
    const fields = {
      name: "name", tag_id: "tagId", status: "status", category: "category",
      chip_uid: "chipUid", chip_paired_at: "chipPairedAt",
      chip_last_ping: "chipLastPing", chip_status: "chipStatus",
      lat: "lat", lng: "lng", last_seen: "lastSeen", battery: "battery",
      description: "description", serial_number: "serialNumber",
      brand: "brand", model: "model", color: "color",
      value_nok: "valueNok", purchased_at: "purchasedAt",
      photo_url: "photoUrl", public_code: "publicCode", lost_message: "lostMessage",
      receipt_url: "receiptUrl",
      home_lat: "homeLat", home_lng: "homeLng",
      geofence_radius_m: "geofenceRadiusM", geofence_alerted: "geofenceAlerted",
      accuracy_m: "accuracyM", speed_mps: "speedMps", temperature_c: "temperatureC",
    };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [col, jsKey] of Object.entries(fields)) {
      if (patch[jsKey] !== undefined) {
        sets.push(`${col} = $${i++}`);
        vals.push(patch[jsKey]);
      }
    }
    if (sets.length === 0) return getItem(id, ownerId);
    vals.push(id, ownerId);
    const r = await pool.query(
      `UPDATE items SET ${sets.join(", ")} WHERE id = $${i++} AND owner_id = $${i} RETURNING *`,
      vals
    );
    return mapItem(r.rows[0]);
  }
  // JSON fallback — whitelist same felter som PG-grenen
  const allowedKeys = [
    "name", "tagId", "status", "category",
    "chipUid", "chipPairedAt", "chipLastPing", "chipStatus",
    "lat", "lng", "lastSeen", "battery",
    "description", "serialNumber", "brand", "model", "color",
    "valueNok", "purchasedAt", "photoUrl", "publicCode", "lostMessage", "receiptUrl",
    "homeLat", "homeLng", "geofenceRadiusM", "geofenceAlerted",
    "accuracyM", "speedMps", "temperatureC",
  ];
  const safePatch = {};
  for (const k of allowedKeys) {
    if (patch[k] !== undefined) safePatch[k] = patch[k];
  }
  const d = jsonLoad();
  const idx = d.items.findIndex((i) => i.id === id && i.ownerId === ownerId);
  if (idx === -1) return null;
  d.items[idx] = { ...d.items[idx], ...safePatch, id, ownerId };
  jsonSave(d);
  return d.items[idx];
}

async function deleteItem(id, ownerId) {
  if (USE_PG) {
    const r = await pool.query(
      `DELETE FROM items WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [id, ownerId]
    );
    return r.rowCount > 0;
  }
  const d = jsonLoad();
  const before = d.items.length;
  d.items = d.items.filter((i) => !(i.id === id && i.ownerId === ownerId));
  jsonSave(d);
  return d.items.length < before;
}

// ----- CHIP -----
async function findItemByChipUid(chipUid) {
  if (USE_PG) {
    const r = await pool.query(`SELECT * FROM items WHERE chip_uid = $1`, [chipUid]);
    return mapItem(r.rows[0]);
  }
  const d = jsonLoad();
  return d.items.find((i) => i.chipUid === chipUid) || null;
}

// ----- CHIP REGISTER (whitelisting av fysisk produserte chiper) -----
// Admin fyller registeret FØR chipene sendes til produsenten. En bruker kan
// bare registrere en gjenstand hvis S-TAG-koden finnes i dette registeret.
// Hver chip har sin egen HMAC-secret som brukes til å signere pings, så en
// kompromittert chip ikke lar angriper forfalske posisjon på andre chiper.
const crypto = require("crypto");

function mapChip(row, { includeSecret = false } = {}) {
  if (!row) return null;
  const chip = {
    uid: row.uid,
    manufacturer: row.manufacturer ?? null,
    batch: row.batch ?? null,
    productType: row.product_type ?? null,
    hardwareRev: row.hardware_rev ?? null,
    firmwareVersion: row.firmware_version ?? null,
    status: row.status,
    claimedBy: row.claimed_by ?? null,
    claimedAt: row.claimed_at ?? null,
    itemId: row.item_id ?? null,
    firstSeenAt: row.first_seen_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    pingCount: row.ping_count ?? 0,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
  // hmac_secret returneres kun når den eksplisitt skal eksponeres
  // (ved produksjon/provisjonering). Aldri i vanlige liste-kall.
  if (includeSecret) chip.hmacSecret = row.hmac_secret ?? null;
  return chip;
}

// 32 bytes random = 256 bits = nok for HMAC-SHA256.
// Base64url uten padding så den kan trygt legges i URL/header om nødvendig.
function generateHmacSecret() {
  return crypto.randomBytes(32).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getChipByUid(uid, opts = {}) {
  if (USE_PG) {
    const r = await pool.query(`SELECT * FROM chips WHERE uid = $1`, [uid]);
    return mapChip(r.rows[0], opts);
  }
  const d = jsonLoad();
  const c = (d.chips || []).find((c) => c.uid === uid);
  if (!c) return null;
  // JSON-fallback: skjul hmacSecret hvis ikke eksplisitt forespurt
  if (opts.includeSecret) return c;
  const { hmacSecret, ...rest } = c;
  return rest;
}

async function listChips({ status, manufacturer, batch, limit = 100, offset = 0 } = {}) {
  if (USE_PG) {
    const where = [];
    const vals = [];
    let i = 1;
    if (status)       { where.push(`status = $${i++}`);       vals.push(status); }
    if (manufacturer) { where.push(`manufacturer = $${i++}`); vals.push(manufacturer); }
    if (batch)        { where.push(`batch = $${i++}`);        vals.push(batch); }
    vals.push(limit, offset);
    const r = await pool.query(
      `SELECT * FROM chips
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
      vals
    );
    return r.rows.map((row) => mapChip(row));
  }
  const d = jsonLoad();
  let list = d.chips || [];
  if (status)       list = list.filter((c) => c.status === status);
  if (manufacturer) list = list.filter((c) => c.manufacturer === manufacturer);
  if (batch)        list = list.filter((c) => c.batch === batch);
  return list.slice(offset, offset + limit).map(({ hmacSecret, ...rest }) => rest);
}

// Opprett én chip. Genererer automatisk en unik hmac_secret hvis ikke satt.
// Returnerer chipen MED secret — dette er det eneste tidspunktet den
// eksponeres i klartekst. Produksjonslinjen må lagre den i chipens
// flash-minne her. Etter dette er den aldri tilgjengelig via API igjen
// (kun brukt server-side for signaturverifikasjon).
async function createChip({ uid, manufacturer, batch, productType, hardwareRev, firmwareVersion, hmacSecret, note }) {
  const trimmed = String(uid || "").trim().toUpperCase();
  if (!trimmed) throw new Error("uid required");
  const secret = hmacSecret || generateHmacSecret();
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO chips (uid, manufacturer, batch, product_type, hardware_rev, firmware_version, hmac_secret, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (uid) DO NOTHING
       RETURNING *`,
      [trimmed, manufacturer || null, batch || null, productType || null,
       hardwareRev || null, firmwareVersion || null, secret, note || null]
    );
    return mapChip(r.rows[0], { includeSecret: true }); // null hvis allerede eksisterer
  }
  const d = jsonLoad();
  d.chips ||= [];
  if (d.chips.some((c) => c.uid === trimmed)) return null;
  const chip = {
    uid: trimmed,
    manufacturer: manufacturer || null,
    batch: batch || null,
    productType: productType || null,
    hardwareRev: hardwareRev || null,
    firmwareVersion: firmwareVersion || null,
    hmacSecret: secret,
    status: "available",
    claimedBy: null,
    claimedAt: null,
    itemId: null,
    firstSeenAt: null,
    lastSeenAt: null,
    pingCount: 0,
    note: note || null,
    createdAt: new Date().toISOString(),
  };
  d.chips.push(chip);
  jsonSave(d);
  return chip;
}

// Bulk-import. Returnerer { created, skipped, secrets[] } der secrets er
// { uid, hmacSecret } for ALLE nye chiper. Dette er det eneste tidspunktet
// secretsene eksponeres — produksjonslinjen MÅ lagre dem i chipens
// flash-minne rett etter opprettelse. Etter dette kan serveren bare
// verifisere signaturer, ikke lese ut secretsene igjen.
async function bulkCreateChips(rows) {
  let created = 0;
  let skipped = 0;
  const secrets = [];
  for (const row of rows) {
    try {
      const r = await createChip(row);
      if (r) {
        created++;
        secrets.push({ uid: r.uid, hmacSecret: r.hmacSecret });
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
    }
  }
  return { created, skipped, total: rows.length, secrets };
}

// Markér chip som "claimed" når en bruker registrerer en gjenstand med den.
// Atomisk i Postgres: SELECT ... FOR UPDATE og deretter UPDATE. I JSON bare
// sekvensiell oppdatering (dev-flyt, ingen samtidighet).
async function claimChip(uid, userId, itemId) {
  const trimmed = String(uid || "").trim().toUpperCase();
  if (USE_PG) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT * FROM chips WHERE uid = $1 FOR UPDATE`,
        [trimmed]
      );
      const chip = r.rows[0];
      if (!chip) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "not_in_register" };
      }
      if (chip.status === "disabled") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "disabled" };
      }
      if (chip.status === "claimed") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "already_claimed" };
      }
      const u = await client.query(
        `UPDATE chips
         SET status = 'claimed', claimed_by = $1, claimed_at = NOW(), item_id = $2
         WHERE uid = $3
         RETURNING *`,
        [userId, itemId, trimmed]
      );
      await client.query("COMMIT");
      return { ok: true, chip: mapChip(u.rows[0]) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  const d = jsonLoad();
  d.chips ||= [];
  const idx = d.chips.findIndex((c) => c.uid === trimmed);
  if (idx === -1) return { ok: false, reason: "not_in_register" };
  const chip = d.chips[idx];
  if (chip.status === "disabled")  return { ok: false, reason: "disabled" };
  if (chip.status === "claimed")   return { ok: false, reason: "already_claimed" };
  d.chips[idx] = {
    ...chip,
    status: "claimed",
    claimedBy: userId,
    claimedAt: new Date().toISOString(),
    itemId,
  };
  jsonSave(d);
  return { ok: true, chip: d.chips[idx] };
}

// Frigir en chip (f.eks. hvis en gjenstand slettes eller en transfer ruller tilbake).
// Brukes også av admin for å nullstille en feilregistrert chip.
async function releaseChip(uid) {
  const trimmed = String(uid || "").trim().toUpperCase();
  if (USE_PG) {
    const r = await pool.query(
      `UPDATE chips
       SET status = 'available', claimed_by = NULL, claimed_at = NULL, item_id = NULL
       WHERE uid = $1
       RETURNING *`,
      [trimmed]
    );
    return mapChip(r.rows[0]);
  }
  const d = jsonLoad();
  const idx = (d.chips || []).findIndex((c) => c.uid === trimmed);
  if (idx === -1) return null;
  d.chips[idx] = { ...d.chips[idx], status: "available", claimedBy: null, claimedAt: null, itemId: null };
  jsonSave(d);
  return d.chips[idx];
}

async function countChips() {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int                                      AS total,
         COUNT(*) FILTER (WHERE status = 'available')::int  AS available,
         COUNT(*) FILTER (WHERE status = 'claimed')::int    AS claimed,
         COUNT(*) FILTER (WHERE status = 'disabled')::int   AS disabled
       FROM chips`
    );
    return r.rows[0];
  }
  const d = jsonLoad();
  const list = d.chips || [];
  return {
    total: list.length,
    available: list.filter((c) => c.status === "available").length,
    claimed: list.filter((c) => c.status === "claimed").length,
    disabled: list.filter((c) => c.status === "disabled").length,
  };
}

async function pairChip(itemId, ownerId, chipUid) {
  return updateItem(itemId, ownerId, {
    chipUid,
    chipPairedAt: new Date().toISOString(),
    chipStatus: "paired",
  });
}

async function unpairChip(itemId, ownerId) {
  return updateItem(itemId, ownerId, {
    chipUid: null,
    chipPairedAt: null,
    chipLastPing: null,
    chipStatus: "unpaired",
  });
}

async function recordChipPing(p) {
  const {
    chipUid, lat, lng, battery, matched,
    accuracyM, altitudeM, speedMps, headingDeg,
    temperatureC, motion, rssi, firmwareVersion, source,
  } = p;
  if (USE_PG) {
    await pool.query(
      `INSERT INTO chip_pings (
         chip_uid, lat, lng, battery, matched,
         accuracy_m, altitude_m, speed_mps, heading_deg,
         temperature_c, motion, rssi, firmware_version, source
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        chipUid, lat ?? null, lng ?? null, battery ?? null, !!matched,
        accuracyM ?? null, altitudeM ?? null, speedMps ?? null, headingDeg ?? null,
        temperatureC ?? null, motion ?? null, rssi ?? null, firmwareVersion || null, source || null,
      ]
    );
    return;
  }
  const d = jsonLoad();
  d.chipPings.push({
    chipUid, lat, lng, battery, matched: !!matched,
    accuracyM, altitudeM, speedMps, headingDeg,
    temperatureC, motion, rssi, firmwareVersion, source,
    at: new Date().toISOString(),
  });
  jsonSave(d);
}

// Oppdater chipen i chips-tabellen med live-telemetri.
// Brukes etter hver vellykket ping for å vedlikeholde first_seen_at,
// last_seen_at, ping_count og firmware_version.
async function markChipPinged(uid, { firmwareVersion } = {}) {
  if (USE_PG) {
    await pool.query(
      `UPDATE chips
       SET last_seen_at = NOW(),
           first_seen_at = COALESCE(first_seen_at, NOW()),
           ping_count = ping_count + 1,
           firmware_version = COALESCE($2, firmware_version)
       WHERE uid = $1`,
      [uid, firmwareVersion || null]
    );
    return;
  }
  const d = jsonLoad();
  const idx = (d.chips || []).findIndex((c) => c.uid === uid);
  if (idx === -1) return;
  const now = new Date().toISOString();
  d.chips[idx] = {
    ...d.chips[idx],
    lastSeenAt: now,
    firstSeenAt: d.chips[idx].firstSeenAt || now,
    pingCount: (d.chips[idx].pingCount || 0) + 1,
    firmwareVersion: firmwareVersion || d.chips[idx].firmwareVersion,
  };
  jsonSave(d);
}

async function updateItemFromPing(chipUid, telemetry = {}) {
  const { lat, lng, battery, accuracyM, speedMps, temperatureC } = telemetry;
  if (USE_PG) {
    const r = await pool.query(
      `UPDATE items SET
         lat           = COALESCE($1, lat),
         lng           = COALESCE($2, lng),
         battery       = COALESCE($3, battery),
         accuracy_m    = COALESCE($4, accuracy_m),
         speed_mps     = COALESCE($5, speed_mps),
         temperature_c = COALESCE($6, temperature_c),
         chip_last_ping = NOW(),
         chip_status    = 'active',
         last_seen      = 'Live · akkurat nå'
       WHERE chip_uid = $7
       RETURNING *`,
      [
        typeof lat === "number" ? lat : null,
        typeof lng === "number" ? lng : null,
        typeof battery === "number" ? battery : null,
        typeof accuracyM === "number" ? accuracyM : null,
        typeof speedMps === "number" ? speedMps : null,
        typeof temperatureC === "number" ? temperatureC : null,
        chipUid,
      ]
    );
    return mapItem(r.rows[0]);
  }
  const d = jsonLoad();
  const idx = d.items.findIndex((i) => i.chipUid === chipUid);
  if (idx === -1) return null;
  if (typeof lat === "number")           d.items[idx].lat = lat;
  if (typeof lng === "number")           d.items[idx].lng = lng;
  if (typeof battery === "number")       d.items[idx].battery = battery;
  if (typeof accuracyM === "number")     d.items[idx].accuracyM = accuracyM;
  if (typeof speedMps === "number")      d.items[idx].speedMps = speedMps;
  if (typeof temperatureC === "number")  d.items[idx].temperatureC = temperatureC;
  d.items[idx].chipLastPing = new Date().toISOString();
  d.items[idx].chipStatus = "active";
  d.items[idx].lastSeen = "Live · akkurat nå";
  jsonSave(d);
  return d.items[idx];
}

// Haversine-distanse i meter — brukes til geofence-sjekk
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Sjekker om en ny posisjon er utenfor item.geofence. Returnerer
// { exceeded, distanceM, radiusM } eller null hvis ingen geofence er satt.
// Server-koden bruker dette til å generere varsler på chip/ping.
async function checkGeofence(itemId, lat, lng) {
  if (USE_PG) {
    // Haversine-beregning direkte i SQL — unngår å hente rad til JS for beregning.
    const r = await pool.query(
      `SELECT id, home_lat, home_lng, geofence_radius_m, geofence_alerted,
         (6371000 * 2 * ASIN(SQRT(
           POWER(SIN(RADIANS($2 - home_lat) / 2), 2) +
           COS(RADIANS(home_lat)) * COS(RADIANS($2)) *
           POWER(SIN(RADIANS($3 - home_lng) / 2), 2)
         ))) AS distance_m
       FROM items
       WHERE id = $1 AND home_lat IS NOT NULL AND home_lng IS NOT NULL AND geofence_radius_m IS NOT NULL`,
      [itemId, lat, lng]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      exceeded: row.distance_m > row.geofence_radius_m,
      distanceM: row.distance_m,
      radiusM: row.geofence_radius_m,
      alreadyAlerted: !!row.geofence_alerted,
    };
  }
  const d = jsonLoad();
  const item = d.items.find((i) => i.id === itemId);
  if (!item || item.homeLat == null || item.homeLng == null || !item.geofenceRadiusM) return null;
  const dist = haversineMeters(item.homeLat, item.homeLng, lat, lng);
  return {
    exceeded: dist > item.geofenceRadiusM,
    distanceM: dist,
    radiusM: item.geofenceRadiusM,
    alreadyAlerted: !!item.geofenceAlerted,
  };
}

async function markGeofenceAlerted(itemId, alerted) {
  if (USE_PG) {
    await pool.query(`UPDATE items SET geofence_alerted = $1 WHERE id = $2`, [!!alerted, itemId]);
    return;
  }
  const d = jsonLoad();
  const idx = d.items.findIndex((i) => i.id === itemId);
  if (idx === -1) return;
  d.items[idx].geofenceAlerted = !!alerted;
  jsonSave(d);
}

// ----- TRANSFERS -----
async function listTransfersForUser(userId, email) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (USE_PG) {
    // Only match to_email if email actually exists — empty string would match empty rows
    const sql = normalizedEmail
      ? `SELECT * FROM transfers WHERE from_user_id = $1 OR LOWER(to_email) = $2 ORDER BY created_at DESC`
      : `SELECT * FROM transfers WHERE from_user_id = $1 ORDER BY created_at DESC`;
    const params = normalizedEmail ? [userId, normalizedEmail] : [userId];
    const r = await pool.query(sql, params);
    return r.rows.map(mapTransfer);
  }
  const d = jsonLoad();
  return d.transfers.filter(
    (t) =>
      t.fromUserId === userId ||
      (normalizedEmail && (t.toEmail || "").toLowerCase() === normalizedEmail)
  );
}

async function createTransfer(t) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO transfers (
         id, item_id, item_name, from_user_id, to_email, note, status,
         sale_price_nok, condition_note, seller_name, buyer_name, payment_method, as_is,
         seller_confirmed_at, contract_version, contract_text
       )
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        t.id,
        t.itemId,
        t.itemName,
        t.fromUserId,
        t.toEmail,
        t.note || "",
        t.salePriceNok ?? null,
        t.conditionNote || null,
        t.sellerName || null,
        t.buyerName || null,
        t.paymentMethod || null,
        t.asIs !== false,
        t.sellerConfirmedAt || new Date().toISOString(),
        t.contractVersion || "2026-04",
        t.contractText || null,
      ]
    );
    return mapTransfer(r.rows[0]);
  }
  const d = jsonLoad();
  d.transfers.push(t);
  jsonSave(d);
  return t;
}

async function getTransfer(id) {
  if (USE_PG) {
    const r = await pool.query(`SELECT * FROM transfers WHERE id = $1`, [id]);
    return mapTransfer(r.rows[0]);
  }
  const d = jsonLoad();
  return d.transfers.find((t) => t.id === id) || null;
}

async function acceptTransfer(transferId, newOwnerId, buyerName) {
  if (USE_PG) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const t = await client.query(
        `UPDATE transfers
            SET status='accepted',
                accepted_at=NOW(),
                buyer_confirmed_at=NOW(),
                buyer_name = COALESCE($2, buyer_name)
          WHERE id=$1 AND status='pending'
          RETURNING *`,
        [transferId, buyerName || null]
      );
      if (t.rows[0]) {
        const itemId = t.rows[0].item_id;
        // Ny eier: ny offentlig kode (gammel QR/lapp skal ikke lenger peke
        // til gjenstanden), og selgers lost-status/hjemme-sone nullstilles.
        await client.query(
          `UPDATE items
              SET owner_id=$1, public_code=$2, status='secured', lost_message=NULL,
                  home_lat=NULL, home_lng=NULL, geofence_radius_m=NULL, geofence_alerted=FALSE
            WHERE id=$3`,
          [newOwnerId, newPublicCode(), itemId]
        );
        await client.query(`UPDATE chips SET claimed_by=$1 WHERE item_id=$2`, [newOwnerId, itemId]);
        await client.query(
          `UPDATE transfers SET status='cancelled' WHERE item_id=$1 AND status='pending' AND id<>$2`,
          [itemId, transferId]
        );
      } else {
        // Allerede akseptert eller kansellert — returnér nåværende rad uendret
        const cur = await client.query(`SELECT * FROM transfers WHERE id=$1`, [transferId]);
        await client.query("COMMIT");
        return mapTransfer(cur.rows[0]);
      }
      await client.query("COMMIT");
      return mapTransfer(t.rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  const d = jsonLoad();
  const t = d.transfers.find((x) => x.id === transferId);
  if (!t) return null;
  if (t.status !== "pending") return t;
  t.status = "accepted";
  t.acceptedAt = new Date().toISOString();
  t.buyerConfirmedAt = t.acceptedAt;
  if (buyerName) t.buyerName = buyerName;
  const itemIdx = d.items.findIndex((i) => i.id === t.itemId);
  if (itemIdx !== -1) {
    Object.assign(d.items[itemIdx], {
      ownerId: newOwnerId,
      publicCode: newPublicCode(),
      status: "secured",
      lostMessage: null,
      homeLat: null,
      homeLng: null,
      geofenceRadiusM: null,
      geofenceAlerted: false,
    });
  }
  for (const c of d.chips) if (c.itemId === t.itemId) c.claimedBy = newOwnerId;
  for (const other of d.transfers) {
    if (other.itemId === t.itemId && other.id !== t.id && other.status === "pending") {
      other.status = "cancelled";
    }
  }
  jsonSave(d);
  return t;
}

function newPublicCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function findPendingTransferForItem(itemId) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM transfers WHERE item_id=$1 AND status='pending' LIMIT 1`,
      [itemId]
    );
    return mapTransfer(r.rows[0]);
  }
  const d = jsonLoad();
  return d.transfers.find((t) => t.itemId === itemId && t.status === "pending") || null;
}

async function setTransferSignature(transferId, role, { jwt, sub, name, signedAt }) {
  const cols =
    role === "seller"
      ? ["seller_signature_jwt", "seller_signature_sub", "seller_signature_name", "seller_signed_at"]
      : ["buyer_signature_jwt", "buyer_signature_sub", "buyer_signature_name", "buyer_signed_at"];
  if (USE_PG) {
    const r = await pool.query(
      `UPDATE transfers
          SET ${cols[0]} = $2, ${cols[1]} = $3, ${cols[2]} = $4, ${cols[3]} = $5
        WHERE id = $1
        RETURNING *`,
      [transferId, jwt, sub || null, name || null, signedAt || new Date().toISOString()]
    );
    return mapTransfer(r.rows[0]);
  }
  const d = jsonLoad();
  const t = d.transfers.find((x) => x.id === transferId);
  if (!t) return null;
  if (role === "seller") {
    t.sellerSignatureJwt = jwt;
    t.sellerSignatureSub = sub || null;
    t.sellerSignatureName = name || null;
    t.sellerSignedAt = signedAt || new Date().toISOString();
  } else {
    t.buyerSignatureJwt = jwt;
    t.buyerSignatureSub = sub || null;
    t.buyerSignatureName = name || null;
    t.buyerSignedAt = signedAt || new Date().toISOString();
  }
  jsonSave(d);
  return t;
}

// ----- USER PROFILE EXTENSIONS -----
async function updateUserProfile(userId, patch) {
  if (USE_PG) {
    const fields = {
      email: "email",
      name: "name",
      phone: "phone",
      address: "address",
      postal_code: "postalCode",
      city: "city",
      avatar_url: "avatarUrl",
      insurance_company: "insuranceCompany",
      insurance_policy: "insurancePolicy",
      notify_email: "notifyEmail",
      notify_push: "notifyPush",
      notify_marketing: "notifyMarketing",
      consent_privacy: "consentPrivacy",
      consent_location: "consentLocation",
      consent_version: "consentVersion",
      consent_terms: "consentTerms",
      consent_accepted_at: "consentAcceptedAt",
      language: "language",
    };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [col, jsKey] of Object.entries(fields)) {
      if (patch[jsKey] !== undefined) {
        sets.push(`${col} = $${i++}`);
        vals.push(patch[jsKey]);
      }
    }
    if (sets.length === 0) return findUserById(userId);
    vals.push(userId);
    const r = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      vals
    );
    return mapUser(r.rows[0]);
  }
  const d = jsonLoad();
  const idx = d.users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  d.users[idx] = { ...d.users[idx], ...patch, id: userId };
  jsonSave(d);
  return d.users[idx];
}

async function updateUserPassword(userId, passwordHash) {
  if (USE_PG) {
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [passwordHash, userId]);
    return true;
  }
  const d = jsonLoad();
  const idx = d.users.findIndex((u) => u.id === userId);
  if (idx === -1) return false;
  d.users[idx].passwordHash = passwordHash;
  jsonSave(d);
  return true;
}

async function touchUserLastSeen(userId) {
  if (USE_PG) {
    await pool.query(`UPDATE users SET last_seen_at = NOW() WHERE id = $1`, [userId]).catch(() => {});
    return;
  }
}

async function deleteUser(userId) {
  if (USE_PG) {
    // Frigi chipene først — ellers blir de stående som 'claimed' uten item
    // (item_id settes NULL via FK) og kan aldri registreres på nytt.
    await pool.query(
      `UPDATE chips SET status='available', claimed_by=NULL, claimed_at=NULL, item_id=NULL
        WHERE claimed_by = $1`,
      [userId]
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return true;
  }
  const d = jsonLoad();
  for (const c of d.chips) {
    if (c.claimedBy === userId) Object.assign(c, { status: "available", claimedBy: null, claimedAt: null, itemId: null });
  }
  d.users = d.users.filter((u) => u.id !== userId);
  d.items = d.items.filter((i) => i.ownerId !== userId);
  d.transfers = d.transfers.filter((t) => t.fromUserId !== userId);
  jsonSave(d);
  return true;
}

// ----- NOTIFICATIONS -----
async function createNotification({ userId, kind, title, body, itemId }) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO notifications (user_id, kind, title, body, item_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [userId, kind, title, body || null, itemId || null]
    );
    return mapNotification(r.rows[0]);
  }
  const d = jsonLoad();
  d.notifications ||= [];
  const n = { id: Date.now(), userId, kind, title, body, itemId, readAt: null, createdAt: new Date().toISOString() };
  d.notifications.push(n);
  jsonSave(d);
  return n;
}

async function listNotifications(userId, limit = 50) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return r.rows.map(mapNotification);
  }
  const d = jsonLoad();
  d.notifications ||= [];
  return d.notifications.filter((n) => n.userId === userId).slice(-limit).reverse();
}

async function markNotificationRead(notifId, userId) {
  if (USE_PG) {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2`,
      [notifId, userId]
    );
    return true;
  }
  return true;
}

async function markAllNotificationsRead(userId) {
  if (USE_PG) {
    await pool.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return true;
  }
  return true;
}

async function deleteAllNotifications(userId) {
  if (USE_PG) {
    await pool.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
  }
  return true;
}

async function countUnreadNotifications(userId) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return r.rows[0].c;
  }
  return 0;
}

// ----- ITEM EVENTS -----
async function createItemEvent({ itemId, userId, kind, detail }) {
  if (USE_PG) {
    await pool.query(
      `INSERT INTO item_events (item_id, user_id, kind, detail) VALUES ($1,$2,$3,$4)`,
      [itemId, userId || null, kind, detail || null]
    );
    return true;
  }
  return true;
}

async function listItemEvents(itemId, limit = 50) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM item_events WHERE item_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [itemId, limit]
    );
    return r.rows.map(mapEvent);
  }
  return [];
}

// ----- STATS -----
async function getUserStats(userId) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'secured')::int AS secured,
        COUNT(*) FILTER (WHERE status = 'missing')::int AS missing,
        COUNT(*) FILTER (WHERE chip_status = 'active')::int AS chip_active,
        COUNT(*) FILTER (WHERE chip_status = 'unpaired')::int AS chip_unpaired,
        COALESCE(SUM(value_nok), 0)::bigint AS total_value
      FROM items WHERE owner_id = $1`,
      [userId]
    );
    const row = r.rows[0];
    return {
      total: row.total,
      secured: row.secured,
      missing: row.missing,
      chipActive: row.chip_active,
      chipUnpaired: row.chip_unpaired,
      totalValueNok: Number(row.total_value),
    };
  }
  const d = jsonLoad();
  const mine = d.items.filter((i) => i.ownerId === userId);
  return {
    total: mine.length,
    secured: mine.filter((i) => i.status === "secured").length,
    missing: mine.filter((i) => i.status === "missing").length,
    chipActive: mine.filter((i) => i.chipStatus === "active").length,
    chipUnpaired: mine.filter((i) => i.chipStatus === "unpaired").length,
    totalValueNok: mine.reduce((s, i) => s + (i.valueNok || 0), 0),
  };
}

// ----- PUBLIC FOUND FLOW -----
async function findItemByPublicCode(code) {
  if (USE_PG) {
    const r = await pool.query(`SELECT * FROM items WHERE public_code = $1`, [code]);
    return mapItem(r.rows[0]);
  }
  const d = jsonLoad();
  return d.items.find((i) => i.publicCode === code) || null;
}

async function createFoundReport({ itemId, finderName, finderContact, message, lat, lng }) {
  if (USE_PG) {
    await pool.query(
      `INSERT INTO found_reports (item_id, finder_name, finder_contact, message, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [itemId, finderName || null, finderContact || null, message || null, lat ?? null, lng ?? null]
    );
    return true;
  }
  return true;
}

async function listFoundReports(itemId) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM found_reports WHERE item_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [itemId]
    );
    return r.rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      finderName: row.finder_name,
      finderContact: row.finder_contact,
      message: row.message,
      lat: row.lat,
      lng: row.lng,
      createdAt: row.created_at,
    }));
  }
  return [];
}

// ----- FEEDBACK -----
async function createFeedback({ userId, name, email, kind, subject, message, userAgent, path }) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO feedback (user_id, name, email, kind, subject, message, user_agent, path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, created_at`,
      [
        userId || null,
        name || null,
        email || null,
        kind || "other",
        subject || null,
        message,
        userAgent || null,
        path || null,
      ]
    );
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
  }
  const d = jsonLoad();
  if (!d.feedback) d.feedback = [];
  const entry = {
    id: d.feedback.length + 1,
    userId: userId || null,
    name: name || null,
    email: email || null,
    kind: kind || "other",
    subject: subject || null,
    message,
    userAgent: userAgent || null,
    path: path || null,
    status: "new",
    createdAt: new Date().toISOString(),
  };
  d.feedback.push(entry);
  jsonSave(d);
  return { id: entry.id, createdAt: entry.createdAt };
}

async function listFeedback(limit = 100) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT * FROM feedback ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      kind: row.kind,
      subject: row.subject,
      message: row.message,
      userAgent: row.user_agent,
      path: row.path,
      status: row.status,
      createdAt: row.created_at,
    }));
  }
  const d = jsonLoad();
  return (d.feedback || []).slice(-limit).reverse();
}

async function pingDb() {
  if (!USE_PG) return { ok: true, store: "json" };
  try {
    await pool.query("SELECT 1");
    return { ok: true, store: "postgres" };
  } catch (err) {
    return { ok: false, store: "postgres", error: err.message };
  }
}

// Slett chip_pings eldre enn N dager (default 90). Kjøres periodisk av server.js.
// Beholder siste ping per chip uansett alder (så man alltid har "siste kjente posisjon").
const PING_RETENTION_DAYS = parseInt(process.env.PING_RETENTION_DAYS, 10) || 90;

async function cleanupOldPings() {
  if (!USE_PG) return 0;
  const r = await pool.query(
    `DELETE FROM chip_pings
     WHERE at < NOW() - INTERVAL '1 day' * $1
       AND id NOT IN (
         SELECT DISTINCT ON (chip_uid) id
         FROM chip_pings
         ORDER BY chip_uid, at DESC
       )`,
    [PING_RETENTION_DAYS]
  );
  return r.rowCount;
}

module.exports = {
  USE_PG,
  initSchema,
  pingDb,
  createUser, findUserByEmail, findUserById, updateUserProfile, updateUserPassword, deleteUser, touchUserLastSeen,
  listItemsByOwner, getItem, createItem, updateItem, deleteItem,
  findItemByChipUid, pairChip, unpairChip, recordChipPing, updateItemFromPing,
  getChipByUid, listChips, createChip, bulkCreateChips, claimChip, releaseChip, countChips,
  markChipPinged, checkGeofence, markGeofenceAlerted,
  listTransfersForUser, createTransfer, getTransfer, acceptTransfer, setTransferSignature,
  findPendingTransferForItem,
  createNotification, listNotifications, markNotificationRead, markAllNotificationsRead, deleteAllNotifications, countUnreadNotifications,
  createItemEvent, listItemEvents,
  getUserStats,
  findItemByPublicCode, createFoundReport, listFoundReports,
  createFeedback, listFeedback,
  cleanupOldPings,
};
