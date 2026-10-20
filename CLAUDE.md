# S-TAG — Claude Code Instruksjoner

> **Denne filen er handoff-dokumentet mellom agenter.**
> Oppdater ALLTID denne filen hvis du endrer noe som påvirker: deploy, miljøvariabler, tjenester, begrensninger, sider, API-endepunkter, eller status. Hvis du er usikker — oppdater. Neste agent har KUN denne filen som kontekst.

## Om prosjektet

S-TAG er et nasjonalt verdiregister for sikring, dokumentasjon og sporing av eiendeler. Brukere registrerer eiendeler med bilde, kvittering og detaljer — uavhengig av om gjenstanden har en S-TAG-chip. Kvitteringer og dokumentasjon lagres i registeret slik at brukeren har bevis ved f.eks. forsikringssaker (husbrann, tyveri). Bruker kan dele dokumentasjon direkte med forsikringsselskapet sitt fra appen.

S-TAG-chip er en valgfri bonus: produkter med innstøpt S-TAG-chip (B2B2C-modell — produsenter embedder chip i jakker, sykler, ski osv.) får i tillegg live-sporing, geofence-varsling og tyveriforebygging. Chipen er allerede koblet til produktet ved kjøp.

## Teknisk stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind v4, react-leaflet, framer-motion, zod
- **Backend:** Express 5, PostgreSQL (pg), JWT auth (HS256, scrypt), dotenv, cors
- **Mobile:** Capacitor (Android ferdig, iOS venter)
- **E-post:** Resend (midlertidig avsender: onboarding@resend.dev — bytt til eget domene etter DNS-verifisering)
- **Deploy:** Vercel (frontend), Railway (backend via GitHub Actions)
- **Repo:** github.com/JE-Studios/s-tag (privat, branch-beskyttet)

## Filstruktur

```
backend/
  server.js             Alle API-endepunkter (vær forsiktig, endringer påvirker hele appen)
  db.js                 Postgres/JSON-fallback datalag
  schema.sql            Database-skjema (IKKE endre uten eksplisitt godkjenning)
  railway.json          Railway build-config
frontend/
  app/                  App Router sider og komponenter
  app/lib/api.ts        API-klient (brukes av ALLE sider — endringer kan brekke alt)
  app/lib/auth-context.tsx  Auth state (brekker denne = alle brukere kastes ut)
  app/lib/i18n.tsx        I18n-system (context, auto-detect, lazy-load). Endringer påvirker alle sider.
  app/lib/translations/   Oversettelsesfiler (nb/en/de/es/fr/da/sv). ~370 nøkler per språk.
  app/components/       Gjenbrukbare: TopBar (m/ språkvelger), BottomNav, Toast, OAuthButtons
  AGENTS.md             Next.js 16-spesifikke agent-regler
mobile/                 Capacitor wrapper
.github/workflows/      GitHub Actions (auto-deploy til Railway)
```

## Frontend-sider

| Rute | Beskrivelse | Krever innlogging |
|------|-------------|-------------------|
| `/` | Redirect til /hjem eller /logg-inn | — |
| `/hjem` | Dashboard med oversikt og statistikk | Ja |
| `/sporing` | Kart med live-posisjon (Leaflet) | Ja |
| `/kartotek` | Gjenstandsregister med CRUD | Ja |
| `/eierskifte` | Overføring/salg mellom brukere | Ja |
| `/varsler` | Notifikasjoner | Ja |
| `/innstillinger` | Profil, samtykke, kontoinnstillinger | Ja |
| `/kontakt` | Tilbakemelding/bug-rapport | Ja |
| `/logg-inn` | Innlogging (e-post + Google OAuth) | Nei |
| `/registrer` | Ny bruker | Nei |
| `/glemt-passord` | Send tilbakestillings-e-post | Nei |
| `/tilbakestill-passord` | Nytt passord via token fra e-post | Nei |
| `/funnet` | Offentlig: rapporter funnet gjenstand via QR/kode | Nei |
| `/personvern` | Personvernerklæring | Nei |
| `/vilkar` | Vilkår for bruk | Nei |

Auth-guard er i `app/lib/auth-context.tsx`. Ruter som ikke krever innlogging er listet i `PUBLIC_ROUTES`.

## Database

| Tabell | Formål |
|--------|--------|
| `users` | Brukerkontoer med profil, samtykke, varselsinnstillinger |
| `items` | Gjenstander med posisjon, chip-status, geofence, telemetri |
| `transfers` | Eierskifte med salgskontrakt og BankID-signaturer (Criipto) |
| `chips` | Whitelist over produserte S-TAG-chiper (fylles av produsent/admin) |
| `chip_pings` | Posisjonsdata/telemetri fra chiper |
| `notifications` | In-app varsler til brukere |
| `item_events` | Aktivitetslogg per gjenstand |
| `found_reports` | Rapporter fra folk som finner gjenstander (offentlig, uten auth) |
| `feedback` | Tilbakemeldinger fra brukere |

Skjemaet er i `backend/schema.sql`. Alle migrasjoner er idempotente (IF NOT EXISTS). Kjøres automatisk ved oppstart av server.js.

## Regler

### Kode
- Skriv all kode på engelsk, all UI-tekst på norsk (bokmål)
- Bruk TypeScript for alt i frontend
- Ikke installer nye npm-pakker uten god grunn
- Les ALLTID filen du skal endre FØR du endrer den
- Sjekk om funksjoner/komponenter du fjerner brukes andre steder (grep)
- Ikke slett eller skriv om eksisterende funksjonalitet uten at det er bedt om
- Behold eksisterende API-kontrakter (response-format, HTTP-metoder, URL-er)

### Sikkerhet
- ALDRI hardkod API-nøkler, secrets eller credentials
- ALDRI commit .env-filer
- Valider all brukerinput på serversiden (backend/server.js)
- Bruk parameteriserte queries mot Postgres (aldri string-concat i SQL)
- CORS tillater ALDRI wildcard `*` — kun eksplisitte domener

### Commit, PR og merge

Hver endring = en feature branch + en PR. Aldri push direkte til main.

Commit-meldinger på norsk. Beskriv HVA og HVORFOR i PR-beskrivelsen.

**Branch protection er aktiv (Ruleset ID 14845507).** Denne prosessen MÅ følges for HVER merge:

```bash
# 1. Deaktiver
gh api repos/JE-Studios/s-tag/rulesets/14845507 --method PUT --field enforcement=disabled
# 2. Merge
gh pr merge <nr> --squash --delete-branch
# 3. Aktiver UMIDDELBART etterpå
gh api repos/JE-Studios/s-tag/rulesets/14845507 --method PUT --field enforcement=active
```

Glem ALDRI steg 3. Branch protection skal alltid være aktiv når du er ferdig.

## Produksjonsmiljø

| Tjeneste | URL | Plattform |
|----------|-----|-----------|
> **Overlevering (oktober 2026):** Prosjektet flyttes til ny eiers egne kontoer
> (GitHub, Vercel, Railway). De gamle adressene under er fra før overleveringen —
> den gamle Railway-backenden finnes ikke lenger. Oppdater tabellen med de nye
> adressene når de er satt opp, og sett alltid `NEXT_PUBLIC_API_URL` (Vercel)
> og `APP_BASE_URL` (Railway) eksplisitt, siden kodens fallback-verdier peker
> til de gamle adressene.

| Tjeneste | URL | Plattform |
|----------|-----|-----------|
| Frontend | https://s-tag-ten.vercel.app (gammel) | Vercel |
| Backend  | https://s-tag-production.up.railway.app (gammel, nede) | Railway |
| Database | PostgreSQL | Railway (tilkoblet via DATABASE_URL) |

### Railway miljøvariabler

| Variabel | Beskrivelse |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (satt av Railway) |
| `JWT_SECRET` | Hemmelig nøkkel for JWT-signering |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `RESEND_API_KEY` | API-nøkkel for Resend e-posttjeneste |
| `APP_BASE_URL` | Frontend-URL for lenker i e-post (https://s-tag-ten.vercel.app) |
| `CORS_ORIGINS` | Valgfri: ekstra CORS-domener (kommaseparert, IKKE wildcard) |
| `FEEDBACK_FROM` | Valgfri: avsenderadresse for e-post (default: onboarding@resend.dev) |
| `WORKERS` | Valgfri: antall cluster workers (default: min(CPU-kjerner, 4)) |
| `PG_POOL_MAX` | Valgfri: maks Postgres-connections per worker (default: 20) |
| `PING_RETENTION_DAYS` | Valgfri: antall dager chip_pings beholdes (default: 90) |

### Vercel miljøvariabler

| Variabel | Beskrivelse |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend-URL (https://s-tag-production.up.railway.app) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth Client ID (samme som backend) |

### GitHub Secrets

| Secret | Beskrivelse |
|--------|-------------|
| `RAILWAY_TOKEN` | Railway **project token** for auto-deploy via GitHub Actions. Må lages på nytt fra ny eiers Railway-prosjekt (Project Settings → Tokens). Railway-tjenesten må hete `s-tag`. |

## Deploy (CI/CD)

### Frontend (Vercel)
Automatisk ved push til main. Alle filer. Ingen konfigurasjon nødvendig.

### Backend (GitHub Actions -> Railway)
Automatisk ved push til main med endringer i `backend/**`.

Workflow-filen: `.github/workflows/deploy-backend.yml`

Railway sin innebygde git-integrasjon fungerer IKKE med squash merges (commit SHA finnes ikke i repo etter squash). Derfor bruker vi GitHub Actions med Railway CLI i stedet.

### Fallback-verdier i koden
- Backend (`server.js`): `APP_BASE_URL` faller tilbake til Vercel-URL i produksjon
- Frontend (`api.ts`): `API_BASE` faller tilbake til Railway-URL i produksjon

Disse fallbackene finnes slik at appen fungerer selv uten at env-variabler er satt, men env-variablene BØR alltid være konfigurert eksplisitt.

## Nåværende status

Oppdater denne seksjonen når du fullfører arbeid eller oppdager nye problemer.

### Fungerer
- Registrering og innlogging (e-post + passord + Google OAuth)
- Glemt passord / tilbakestill passord (e-post sendes kun til kontoeier, se begrensninger)
- Gjenstands-CRUD (opprett, rediger, slett) — chip er valgfri, gjenstander kan registreres som ren verdidokumentasjon
- Kvittering/dokumentasjon per gjenstand (bilde av kvittering lagres i registeret)
- Forsikringsinfo i innstillinger (selskap + polisenummer) + "Del med forsikring"-knapp på gjenstandsdetalj
- Chip-paring og -unparing
- Eierskifte med salgskontrakt og BankID-signering (Criipto)
- Kart med live-sporing og geofence
- Notifikasjoner (in-app)
- Posisjonssamtykke respekteres i kart og innstillinger
- Tilbakemelding/kontaktskjema
- Funnet-gjenstand offentlig flyt (QR-kode -> rapporter funn)
- CORS er sikkert (kun eksplisitte domener, aldri wildcard)
- Auto-deploy: frontend via Vercel, backend via GitHub Actions
- Flerspråklig: 7 språk (nb, en, de, es, fr, da, sv) med auto-deteksjon og språkvelger i TopBar
- JWT expiry-sjekk i frontend (utløpt token fjernes automatisk)
- Geocoding debounce (400ms) på sporingssiden
- Skalerbar backend: Node.js cluster mode (multi-core), optimalisert pg.Pool, parallelle DB-kall på chip/ping, geofence-beregning i SQL, automatisk opprydding av gamle chip_pings (90 dager default)

### Blokkert
- **E-post til andre brukere:** Resend sin test-avsender (`onboarding@resend.dev`) kan KUN sende til kontoeier (`eliah.slette@gmail.com`). Alle andre brukere får ikke e-post (glemt passord, varsler osv.). Krever: kjøpe eget domene + verifisere DNS i Resend.
- **Apple-innlogging (Sign in with Apple):** Krever Apple Developer Program ($99/år) + ID-verifisering. Ikke startet.

### Neste steg
- Kjøpe domene og verifisere i Resend -> e-post fungerer for alle brukere
- Apple Developer Program -> Sign in with Apple
- Mobilapp: Capacitor er satt opp, Android bygger, iOS venter på Apple Developer Program
- Tracking-hardware: klient må velge chip-teknologi (se "Tracking-hardware" under Kjente begrensninger)

## Kjente begrensninger

- **Resend e-post:** `onboarding@resend.dev` er en test-avsender som kun kan sende til kontoeier. Trenger eget domene.
- **Apple-innlogging:** Ikke konfigurert. Trenger Apple Developer Program.
- **schema.sql:** Endringer kan ødelegge eksisterende data. Ikke endre uten eksplisitt godkjenning fra prosjekteier.
- **Next.js 16:** Har breaking changes fra tidligere versjoner. Les `frontend/AGENTS.md` før du skriver frontend-kode.
- **Samtykke-toggles:** Posisjon fungerer (styrer GPS). E-post-varsler, push-varsler og markedsføring lagres i DB men har ingen effekt ennå (mangler domene/push-infra). Ikke fjern dem — de er GDPR-samtykke som trengs når funksjonene implementeres.
- **i18n:** Alle UI-strenger bruker `t()` fra `app/lib/i18n.tsx`. Nye sider MÅ bruke `useTranslation()` og legge nye nøkler i ALLE 7 oversettelsesfiler. Norsk (nb) er fallback — manglende nøkler i andre språk viser norsk tekst.
- **Cookies:** Appen bruker kun localStorage (token, språk, geo-samtykke) — ingen cookies, ingen analytics, ingen cookie-banner nødvendig.
- **Tracking-hardware:** Klienten (startup) har IKKE valgt chip ennå. Backenden er klar (`POST /api/chip/ping` tar imot GPS, batteri, telemetri med HMAC-signering), men det finnes ingen fysisk tracker. Aktuelle alternativer: **LTE-M/NB-IoT** (mobilnett, fungerer overalt med dekning, krever eSIM + IoT-abonnement ~20-50 kr/mnd), **BLE** (kort rekkevidde, avhengig av crowd-nettverk som Apple Find My), eller **hybrid**. For S-TAGs bruksområder (jakker, sykler, ski i Norge) er LTE-M mest aktuelt for sporing overalt. Ikke implementer chip-spesifikk kode før klienten har valgt teknologi.

## Lokal utvikling

```bash
# Backend (terminal 1)
cd backend && npm install && node server.js
# Kjører på http://localhost:4000

# Frontend (terminal 2)
cd frontend && npm install && npm run dev
# Kjører på http://localhost:3000
```

## Team

- Prosjektet er overlevert til ny eier (oktober 2026). Eliah og Jonah er ikke lenger involvert.
