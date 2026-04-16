"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import TopBar from "../components/TopBar";
import Logo from "../components/Logo";
import { chip, items as itemsApi, Item } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useTranslation } from "../lib/i18n";
import { useToast } from "../components/Toast";

// Aksepterte UID-format: 4–32 tegn, kun alfanumerisk. NFC type 2 tags bruker
// typisk 7 bytes (14 hex-tegn); type 1 bruker 4 bytes (8 hex). Vi er bevisst
// permissive slik at klient kan bruke hvilken format de vil — backend tillater
// fritt format i `chip_uid TEXT UNIQUE`.
function normalizeUid(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function isValidUid(uid: string): boolean {
  return /^[A-Z0-9]{4,32}$/.test(uid);
}

export default function ParePageWrapper() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <ParePage />
    </Suspense>
  );
}

function LoadingShell() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center px-6">
      <div className="w-10 h-10 rounded-xl bg-[#0f2a5c]/5 flex items-center justify-center animate-pulse">
        <span className="material-symbols-outlined text-[#0f2a5c] text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
          nfc
        </span>
      </div>
    </div>
  );
}

function ParePage() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();

  const rawUid = searchParams.get("uid") || "";
  const uid = useMemo(() => normalizeUid(rawUid), [rawUid]);
  const uidOk = isValidUid(uid);

  const [list, setList] = useState<Item[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairedItem, setPairedItem] = useState<Item | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);

  // Hvis URL mangler gyldig UID, hent ikke items i det hele tatt.
  // Hvis bruker ikke er innlogget, håndterer auth-guard redirect til /logg-inn.
  useEffect(() => {
    if (!user || !uidOk) return;
    let cancelled = false;
    itemsApi
      .list()
      .then((data) => {
        if (cancelled) return;
        setList(data);
        // Hvis denne chippen allerede er paret med en av brukerens egne
        // gjenstander, vis suksess direkte uten å tvinge ny handling.
        const alreadyMine = data.find((i) => (i.chipUid || "").toUpperCase() === uid);
        if (alreadyMine) setPairedItem(alreadyMine);
      })
      .catch((err) => {
        if (!cancelled) setListError(err?.message || t("common.error"));
      });
    return () => {
      cancelled = true;
    };
  }, [user, uidOk, uid, t]);

  // Venter på auth-status — auth-context viser egen splash hvis privat rute
  if (authLoading) return <LoadingShell />;

  // Ugyldig eller manglende UID
  if (!uidOk) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex flex-col items-center justify-center px-6">
        <Link href="/" className="mb-8">
          <Logo />
        </Link>
        <div className="w-full max-w-md bg-white rounded-2xl border border-red-200 shadow-xl p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-red-600 text-2xl">link_off</span>
          </div>
          <h1 className="text-xl font-black text-slate-900 mb-2">{t("pare.invalidTitle")}</h1>
          <p className="text-sm text-slate-500 mb-6">{t("pare.invalidBody")}</p>
          <Link
            href="/hjem"
            className="inline-block py-3 px-5 rounded-2xl bg-[#0f2a5c] text-white font-bold text-sm"
          >
            {t("pare.goHome")}
          </Link>
        </div>
      </div>
    );
  }

  async function handlePair(itemId: string) {
    setPairing(true);
    setPairError(null);
    try {
      const updated = await chip.pair(itemId, uid);
      setPairedItem(updated);
      toast.success(t("pare.successToast"));
    } catch (err: any) {
      const msg = err?.message || t("common.error");
      setPairError(msg);
      toast.error(msg);
    } finally {
      setPairing(false);
    }
  }

  // Suksess — chip er paret
  if (pairedItem) {
    return (
      <>
        <TopBar />
        <main className="pt-24 pb-20 px-6 max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="bg-white rounded-2xl border border-emerald-200 shadow-xl p-6 text-center mb-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                <span
                  className="material-symbols-outlined text-emerald-600 text-3xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
              </div>
              <h1 className="text-2xl font-black text-slate-900 mb-2">
                {t("pare.successTitle")}
              </h1>
              <p className="text-sm text-slate-500 mb-6">
                {t("pare.successBody", pairedItem.name)}
              </p>
              <div className="bg-slate-50 rounded-xl p-4 mb-4 text-left">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                  {t("pare.chipUid")}
                </p>
                <p className="text-xs font-mono text-slate-700 break-all">{uid}</p>
              </div>
              <Link
                href={`/kartotek/detalj?id=${encodeURIComponent(pairedItem.id)}`}
                className="block w-full py-3 rounded-2xl bg-[#0f2a5c] text-white font-bold text-sm hover:bg-[#1a3d7c] transition"
              >
                {t("pare.viewItem")}
              </Link>
              <Link
                href="/hjem"
                className="block mt-3 text-center text-sm text-slate-500 hover:text-slate-700"
              >
                {t("pare.goHome")}
              </Link>
            </div>
          </motion.div>
        </main>
      </>
    );
  }

  // Hovedvisning: pare til eksisterende gjenstand, eller opprett ny
  const unpaired = (list || []).filter((i) => !i.chipUid);
  const createHref = `/kartotek/ny?chipUid=${encodeURIComponent(uid)}`;

  return (
    <>
      <TopBar />
      <main className="pt-24 pb-20 px-6 max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-[#0f2a5c] flex items-center justify-center mx-auto mb-4">
              <span
                className="material-symbols-outlined text-white text-3xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                nfc
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">
              {t("pare.title")}
            </h1>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">{t("pare.subtitle")}</p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 border border-slate-200">
              <span className="material-symbols-outlined text-slate-500 text-sm">qr_code_2</span>
              <span className="text-xs font-mono font-bold text-slate-700 break-all">{uid}</span>
            </div>
          </div>

          {pairError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
              {pairError}
            </div>
          )}

          {listError && !list && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
              {listError}
            </div>
          )}

          {list === null && !listError && (
            <div className="space-y-3">
              <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
              <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
            </div>
          )}

          {list !== null && (
            <>
              <Link
                href={createHref}
                className="group block bg-[#0f2a5c] text-white rounded-2xl p-5 mb-4 shadow-lg shadow-[#0f2a5c]/20 hover:bg-[#1a3d7c] transition"
              >
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
                    <span
                      className="material-symbols-outlined text-white text-2xl"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      add_circle
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-base">{t("pare.createNew")}</p>
                    <p className="text-xs text-white/70">{t("pare.createNewSub")}</p>
                  </div>
                  <span className="material-symbols-outlined text-white/60 group-hover:text-white transition">
                    arrow_forward
                  </span>
                </div>
              </Link>

              {unpaired.length > 0 && (
                <>
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {t("pare.orPairExisting")}
                    </span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                  <ul className="space-y-2">
                    <AnimatePresence initial={false}>
                      {unpaired.map((item) => (
                        <motion.li
                          key={item.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3 }}
                        >
                          <button
                            type="button"
                            onClick={() => handlePair(item.id)}
                            disabled={pairing}
                            className="w-full text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-[#0f2a5c] hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {item.photoUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.photoUrl}
                                    alt={item.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="material-symbols-outlined text-slate-400">
                                    category
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-900 text-sm truncate">
                                  {item.name}
                                </p>
                                <p className="text-[11px] text-slate-500 font-mono truncate">
                                  {item.tagId}
                                </p>
                              </div>
                              <span className="material-symbols-outlined text-slate-300 group-hover:text-[#0f2a5c] transition">
                                {pairing ? "progress_activity" : "link"}
                              </span>
                            </div>
                          </button>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </>
              )}

              {unpaired.length === 0 && (
                <p className="text-xs text-slate-400 text-center mt-4 leading-relaxed">
                  {t("pare.noUnpaired")}
                </p>
              )}
            </>
          )}

          <p className="mt-8 text-center text-[11px] text-slate-400 leading-relaxed">
            {t("pare.help", user?.email || "")}
          </p>
        </motion.div>
      </main>
    </>
  );
}
