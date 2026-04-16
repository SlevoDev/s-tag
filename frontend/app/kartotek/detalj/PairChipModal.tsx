"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { chip } from "../../lib/api";
import { useTranslation } from "../../lib/i18n";

function normalizeUid(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Web NFC — kun tilgjengelig på Android Chrome/Edge. iOS Safari støtter ikke API-et.
// Vi feature-detecter `NDEFReader` og viser "Skann"-knappen kun når støttet.
type NDEFMessage = { records: { recordType: string; data: ArrayBuffer }[] };
type NDEFReaderLike = {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((ev: { serialNumber?: string; message: NDEFMessage }) => void) | null;
  onreadingerror: (() => void) | null;
};
type NDEFReaderCtor = new () => NDEFReaderLike;

function getNDEFReader(): NDEFReaderCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { NDEFReader?: NDEFReaderCtor };
  return w.NDEFReader || null;
}

export default function PairChipModal({
  itemId,
  open,
  onClose,
  onPaired,
}: {
  itemId: string;
  open: boolean;
  onClose: () => void;
  onPaired: () => void;
}) {
  const { t } = useTranslation();
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nfcSupported = getNDEFReader() !== null;

  useEffect(() => {
    if (!open) {
      setUid("");
      setError(null);
      setScanError(null);
      setScanning(false);
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  // Rydder opp scan hvis komponenten avmonteres mens skanning er aktiv
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function startScan() {
    const NDEFReader = getNDEFReader();
    if (!NDEFReader) {
      setScanError(t("pareModal.nfcUnsupported"));
      return;
    }
    setScanError(null);
    setScanning(true);
    try {
      const reader = new NDEFReader();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      reader.onreading = (event) => {
        const serial = event.serialNumber ? normalizeUid(event.serialNumber) : "";
        if (serial) {
          setUid(serial);
          ctrl.abort();
          setScanning(false);
        }
      };
      reader.onreadingerror = () => {
        setScanError(t("pareModal.scanFailed"));
      };
      await reader.scan({ signal: ctrl.signal });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setScanError(err?.message || t("pareModal.scanFailed"));
      setScanning(false);
    }
  }

  function stopScan() {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = normalizeUid(uid);
    if (clean.length < 4) {
      setError(t("pareModal.tooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await chip.pair(itemId, clean);
      onPaired();
    } catch (err: any) {
      setError(err?.message || t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 z-40"
          />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-4 top-20 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md z-50"
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0f2a5c]/10 flex items-center justify-center">
                    <span
                      className="material-symbols-outlined text-[#0f2a5c]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      nfc
                    </span>
                  </div>
                  <h2 className="text-lg font-black text-slate-900">{t("pareModal.title")}</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center"
                  aria-label={t("common.cancel")}
                >
                  <span className="material-symbols-outlined text-slate-500">close</span>
                </button>
              </div>

              <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                {t("pareModal.subtitle")}
              </p>

              {nfcSupported && (
                <div className="mb-4">
                  {!scanning ? (
                    <button
                      type="button"
                      onClick={startScan}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-[#0f2a5c]/30 bg-[#0f2a5c]/5 text-[#0f2a5c] font-bold text-sm hover:bg-[#0f2a5c]/10 transition"
                    >
                      <span className="material-symbols-outlined text-lg">contactless</span>
                      {t("pareModal.scanNfc")}
                    </button>
                  ) : (
                    <div className="rounded-2xl border-2 border-[#0f2a5c] bg-[#0f2a5c]/5 p-4 text-center">
                      <div className="w-12 h-12 rounded-full bg-[#0f2a5c]/10 flex items-center justify-center mx-auto mb-2">
                        <span
                          className="material-symbols-outlined text-[#0f2a5c] text-2xl animate-pulse"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          contactless
                        </span>
                      </div>
                      <p className="text-sm font-bold text-[#0f2a5c] mb-1">
                        {t("pareModal.scanning")}
                      </p>
                      <p className="text-xs text-slate-500 mb-3">{t("pareModal.scanningHint")}</p>
                      <button
                        type="button"
                        onClick={stopScan}
                        className="text-xs font-bold text-slate-500 underline"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  )}
                  {scanError && (
                    <p className="text-xs text-red-600 mt-2">{scanError}</p>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  {t("pareModal.manualLabel")}
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  inputMode="text"
                  spellCheck={false}
                  value={uid}
                  onChange={(e) => {
                    setUid(e.target.value.toUpperCase());
                    setError(null);
                  }}
                  placeholder={t("pareModal.manualPlaceholder")}
                  className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 text-slate-900 font-mono uppercase placeholder:text-slate-400 placeholder:font-sans placeholder:normal-case focus:outline-none focus:border-[#0f2a5c] focus:ring-2 focus:ring-[#0f2a5c]/10 transition"
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  {t("pareModal.manualHint")}
                </p>

                {error && (
                  <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                    {error}
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={busy || normalizeUid(uid).length < 4}
                    className="py-3 rounded-2xl bg-[#0f2a5c] text-white font-bold text-sm hover:bg-[#1a3d7c] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {busy && (
                      <span className="material-symbols-outlined animate-spin text-sm">
                        progress_activity
                      </span>
                    )}
                    {busy ? t("pareModal.pairing") : t("pareModal.pair")}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
