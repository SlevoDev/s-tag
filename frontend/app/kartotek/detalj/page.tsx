"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import TopBar from "../../components/TopBar";
import PhotoPicker from "../../components/PhotoPicker";
import PairChipModal from "./PairChipModal";
import { items as itemsApi, ItemEvent, Item, FoundReport, API_BASE } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useToast } from "../../components/Toast";
import { useTranslation } from "../../lib/i18n";

const MapView = dynamic(() => import("../../sporing/MapView"), { ssr: false });

const EVENT_ICON: Record<string, string> = {
  created: "add_circle",
  updated: "edit",
  chip_paired: "nfc",
  chip_unpaired: "nfc_off",
  marked_lost: "location_off",
  marked_found: "check_circle",
  transferred: "swap_horiz",
  found_report: "person_pin_circle",
};

export default function ItemDetailPageWrapper() {
  return (
    <Suspense fallback={null}>
      <ItemDetailPage />
    </Suspense>
  );
}

function ItemDetailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const id = searchParams.get("id") || "";
  const [item, setItem] = useState<Item | null>(null);
  const [events, setEvents] = useState<ItemEvent[]>([]);
  const [foundReports, setFoundReports] = useState<FoundReport[]>([]);
  const [address, setAddress] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [photoEdit, setPhotoEdit] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

  const statusMeta = {
    secured: { label: t("common.secured"), color: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500", icon: "verified" },
    missing: { label: t("common.missing"), color: "text-red-600", bg: "bg-red-50", dot: "bg-red-500", icon: "warning" },
    inactive: { label: t("common.inactive"), color: "text-slate-600", bg: "bg-slate-100", dot: "bg-slate-400", icon: "pause_circle" },
  };

  const timeAgo = (iso: string) => {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return t("time.now");
    if (diff < 3600) return t("time.minutesAgo", Math.floor(diff / 60));
    if (diff < 86400) return t("time.hoursAgo", Math.floor(diff / 3600));
    if (diff < 604800) return t("time.daysAgo", Math.floor(diff / 86400));
    return d.toLocaleDateString("nb-NO");
  };

  const refreshItem = async () => {
    const data = await itemsApi.get(id);
    setItem(data);
    return data;
  };

  useEffect(() => {
    itemsApi
      .get(id)
      .then((data) => {
        setItem(data);
        setLoading(false);
        if (data.chipStatus !== "unpaired") {
          fetch(`${API_BASE}/api/geocode?lat=${data.lat}&lng=${data.lng}`)
            .then((r) => r.json())
            .then((g) => g && setAddress(g.display || ""))
            .catch(() => {});
        }
        itemsApi.events(id).then(setEvents).catch(() => setEvents([]));
        itemsApi.foundReports(id).then(setFoundReports).catch(() => setFoundReports([]));
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <>
        <TopBar showBack />
        <main className="pt-28 px-6 max-w-2xl mx-auto">
          <div className="space-y-4">
            <div className="h-12 w-2/3 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-48 w-full bg-slate-100 rounded-2xl animate-pulse" />
            <div className="h-32 w-full bg-slate-100 rounded-2xl animate-pulse" />
          </div>
        </main>
      </>
    );
  }

  if (!item) {
    return (
      <>
        <TopBar showBack />
        <main className="pt-28 px-6 max-w-2xl mx-auto text-center">
          <p className="text-slate-500">{t("detalj.notFound")}</p>
        </main>
      </>
    );
  }

  const meta = statusMeta[item.status];
  const isMissing = item.status === "missing";

  const toggleLost = async () => {
    setToggling(true);
    try {
      if (isMissing) {
        await itemsApi.markFound(item.id);
        toast.success(t("detalj.markedFound"));
      } else {
        const msg = window.prompt(t("detalj.lostPrompt")) || "";
        await itemsApi.markLost(item.id, msg);
        toast.info(t("detalj.markedMissing"));
      }
      await refreshItem();
      const ev = await itemsApi.events(id);
      setEvents(ev);
    } catch (err: any) {
      toast.error(err.message || "Kunne ikke oppdatere");
    } finally {
      setToggling(false);
    }
  };

  const handlePhotoChange = async (newUrl: string) => {
    if (!item) return;
    setPhotoEdit(newUrl);
    try {
      const updated = await itemsApi.update(item.id, { photoUrl: newUrl || null } as Partial<Item>);
      setItem(updated);
      setPhotoEdit(null);
      toast.success(newUrl ? t("detalj.photoUpdated") : t("detalj.photoRemoved"));
    } catch (err: unknown) {
      setPhotoEdit(null);
      const msg = err instanceof Error ? err.message : "Kunne ikke oppdatere bilde";
      toast.error(msg);
    }
  };

  const removeItem = async () => {
    if (!confirm(t("detalj.confirmDelete", item.name))) return;
    setDeleting(true);
    try {
      await itemsApi.remove(item.id);
      toast.success(t("detalj.deleted"));
      router.replace("/kartotek");
    } catch (err: any) {
      toast.error(err.message || "Kunne ikke slette");
      setDeleting(false);
    }
  };

  return (
    <>
      <TopBar showBack />
      <main className="pt-24 pb-40 px-6 max-w-2xl mx-auto">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6"
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-4xl font-extrabold text-slate-900 leading-tight tracking-tight">
                {item.name}
              </h1>
              <p className="text-slate-500 font-mono text-sm mt-1">{item.tagId}</p>
            </div>
          </div>
        </motion.div>

        {/* Savnet-banner */}
        {isMissing && item.lostMessage && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-red-700 mb-1">
              {t("detalj.msgToFinders")}
            </p>
            <p className="text-sm text-red-900">{item.lostMessage}</p>
          </div>
        )}

        {/* Bilde */}
        <div className="mb-4">
          <PhotoPicker
            value={photoEdit !== null ? photoEdit : (item.photoUrl || "")}
            onChange={handlePhotoChange}
          />
        </div>

        {/* Kart + adresse — kun for gjenstander med chip */}
        {item.chipStatus !== "unpaired" && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="mb-6 rounded-2xl overflow-hidden border border-slate-200 shadow-sm h-56"
            >
              <MapView items={[item]} selectedId={item.id} />
            </motion.div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <span
                    className="material-symbols-outlined text-[#0f2a5c] text-xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    location_on
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {t("detalj.lastSeen")}
                  </p>
                  <p className="text-slate-900 font-bold text-base">{address || item.lastSeen}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 pt-3 border-t border-slate-100">
                <div>
                  <span className="block text-[10px] uppercase tracking-widest text-slate-400 font-bold">{t("detalj.latitude")}</span>
                  <span className="text-slate-700 font-mono">{item.lat.toFixed(5)}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-widest text-slate-400 font-bold">{t("detalj.longitude")}</span>
                  <span className="text-slate-700 font-mono">{item.lng.toFixed(5)}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Info */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm space-y-4">
          <DetailRow icon="qr_code_2" label={t("detalj.tagId")} value={item.tagId} mono />
          {item.brand && <DetailRow icon="sell" label={t("detalj.brand")} value={item.brand} />}
          {item.model && <DetailRow icon="category" label={t("detalj.model")} value={item.model} />}
          {item.color && <DetailRow icon="palette" label={t("detalj.color")} value={item.color} />}
          {item.serialNumber && (
            <DetailRow icon="fingerprint" label={t("detalj.serial")} value={item.serialNumber} mono />
          )}
          {item.valueNok && (
            <DetailRow
              icon="payments"
              label={t("detalj.value")}
              value={`${new Intl.NumberFormat("nb-NO").format(item.valueNok)} kr`}
            />
          )}
          {item.purchasedAt && (
            <DetailRow
              icon="calendar_month"
              label={t("detalj.purchased")}
              value={new Date(item.purchasedAt).toLocaleDateString("nb-NO")}
            />
          )}
          {item.description && (
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                {t("detalj.description")}
              </p>
              <p className="text-sm text-slate-700 leading-relaxed">{item.description}</p>
            </div>
          )}
          {item.publicCode && (
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                {t("detalj.publicCode")}
              </p>
              <p className="text-sm text-slate-900 font-mono">{item.publicCode}</p>
              <p className="text-[10px] text-slate-500 mt-1">
                {t("detalj.publicCodeHint", item.publicCode)}
              </p>
            </div>
          )}
        </div>

        {/* Kvittering / dokumentasjon */}
        {item.receiptUrl && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-amber-700 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t("detalj.receipt")}</p>
                <p className="text-slate-700 font-bold text-sm">{t("detalj.receiptSaved")}</p>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.receiptUrl} alt={t("detalj.receipt")} className="w-full object-contain max-h-64" />
            </div>
          </div>
        )}

        {/* Del med forsikring */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <span className="material-symbols-outlined text-blue-700 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>shield</span>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t("detalj.insurance")}</p>
              <p className="text-slate-700 font-bold text-sm">{t("detalj.insuranceDesc")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const lines = [
                t("detalj.insuranceReport"),
                "",
                `${t("common.name")}: ${item.name}`,
                item.brand ? `${t("detalj.brand")}: ${item.brand}` : null,
                item.model ? `${t("detalj.model")}: ${item.model}` : null,
                item.color ? `${t("detalj.color")}: ${item.color}` : null,
                item.serialNumber ? `${t("detalj.serial")}: ${item.serialNumber}` : null,
                item.valueNok ? `${t("detalj.value")}: ${new Intl.NumberFormat("nb-NO").format(item.valueNok)} kr` : null,
                item.purchasedAt ? `${t("detalj.purchased")}: ${new Date(item.purchasedAt).toLocaleDateString("nb-NO")}` : null,
                item.category ? `${t("kartotekNy.category")}: ${item.category}` : null,
                `${t("detalj.tagId")}: ${item.tagId}`,
                "",
                user?.insuranceCompany ? `${t("settings.insuranceCompany")}: ${user.insuranceCompany}` : null,
                user?.insurancePolicy ? `${t("settings.insurancePolicy")}: ${user.insurancePolicy}` : null,
                "",
                `${t("detalj.insuranceGenerated")} ${new Date().toLocaleDateString("nb-NO")}`,
              ].filter(Boolean).join("\n");

              if (navigator.share) {
                navigator.share({ title: `S-TAG — ${item.name}`, text: lines }).catch(() => {});
              } else {
                navigator.clipboard.writeText(lines);
                toast.success(t("detalj.insuranceCopied"));
              }
            }}
            className="w-full py-3.5 rounded-2xl border border-blue-200 text-blue-700 font-bold hover:bg-blue-50 transition flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">share</span>
            {t("detalj.shareInsurance")}
          </button>
          {!user?.insuranceCompany && (
            <p className="text-[11px] text-slate-400 mt-2 text-center">
              {t("detalj.insuranceTip")}
            </p>
          )}
        </div>

        {/* Pare chip — vises når ingen chip er registrert */}
        {item.chipStatus === "unpaired" && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#0f2a5c]/10 flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-[#0f2a5c]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  nfc
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {t("detalj.pair.label")}
                </p>
                <p className="text-slate-900 font-bold text-sm">{t("detalj.pair.title")}</p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
              {t("detalj.pair.info")}
            </p>
            <button
              type="button"
              onClick={() => setPairOpen(true)}
              className="w-full py-3 rounded-2xl bg-[#0f2a5c] text-white font-bold text-sm hover:bg-[#1a3d7c] transition flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">add_link</span>
              {t("detalj.pair.cta")}
            </button>
          </div>
        )}

        {/* S-TAG chip (innstøpt av produsent) — kun synlig når chip finnes */}
        {item.chipStatus !== "unpaired" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-[#0f2a5c]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  memory
                </span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {t("detalj.chip.title")}
                </p>
                <p className="text-slate-900 font-bold text-sm">
                  {item.chipStatus === "active" && t("detalj.chip.active")}
                  {item.chipStatus === "paired" && t("detalj.chip.paired")}
                  {item.chipStatus === "lost" && t("detalj.chip.lost")}
                </p>
              </div>
            </div>
            <span
              className={`w-2 h-2 rounded-full ${
                item.chipStatus === "active"
                  ? "bg-emerald-500 animate-pulse"
                  : item.chipStatus === "lost"
                  ? "bg-red-500"
                  : "bg-amber-500"
              }`}
            />
          </div>
          {item.chipUid && (
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                {t("detalj.chip.code")}
              </p>
              <p className="text-xs text-slate-700 font-mono break-all">{item.chipUid}</p>
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
            {t("detalj.chip.info")}
          </p>
        </div>
        )}

        {/* Funnrapporter */}
        {foundReports.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-emerald-700 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>person_pin_circle</span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{t("detalj.foundReports")}</p>
                <p className="text-slate-700 font-bold text-sm">{t("detalj.foundReportsCount", foundReports.length)}</p>
              </div>
            </div>
            <div className="space-y-3">
              {foundReports.map((r) => (
                <div key={r.id} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-emerald-900">
                      {r.finderName || t("detalj.anonymousFinder")}
                    </p>
                    <p className="text-[10px] text-slate-400">{timeAgo(r.createdAt)}</p>
                  </div>
                  {r.message && <p className="text-sm text-slate-700 mb-2">{r.message}</p>}
                  {r.finderContact && (
                    <p className="text-xs text-slate-500">
                      <span className="font-semibold">{t("detalj.contact")}:</span> {r.finderContact}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aktivitetslogg */}
        {events.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3">{t("detalj.activityLog")}</h3>
            <div className="space-y-3">
              {events.map((ev) => (
                <div key={ev.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-slate-600 text-[18px]">
                      {EVENT_ICON[ev.kind] || "circle"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 capitalize">
                      {ev.kind.replace(/_/g, " ")}
                    </p>
                    {ev.detail && <p className="text-xs text-slate-500 truncate">{ev.detail}</p>}
                    <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(ev.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Handlinger */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={toggleLost}
            disabled={toggling}
            className={`rounded-2xl py-4 px-4 flex flex-col items-center gap-2 shadow-sm border transition disabled:opacity-50 ${
              isMissing
                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                : "bg-red-50 border-red-200 text-red-700 hover:bg-red-100"
            }`}
          >
            <span className={`material-symbols-outlined ${toggling ? "animate-spin" : ""}`}>
              {toggling ? "progress_activity" : isMissing ? "check_circle" : "location_off"}
            </span>
            <span className="text-xs font-bold">{isMissing ? t("detalj.markFound") : t("detalj.markMissing")}</span>
          </button>
          <button
            onClick={removeItem}
            disabled={deleting}
            className="bg-white border border-slate-200 text-slate-700 rounded-2xl py-4 px-4 flex flex-col items-center gap-2 shadow-sm hover:bg-slate-50 transition disabled:opacity-50"
          >
            <span className={`material-symbols-outlined ${deleting ? "animate-spin" : ""}`}>
              {deleting ? "progress_activity" : "delete"}
            </span>
            <span className="text-xs font-bold">{t("detalj.deleteItem")}</span>
          </button>
        </div>
      </main>
      <PairChipModal
        itemId={item.id}
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        onPaired={async () => {
          setPairOpen(false);
          toast.success(t("pareModal.success"));
          try {
            await refreshItem();
            const ev = await itemsApi.events(id);
            setEvents(ev);
          } catch {
            /* stille — siden blir frisket ved neste navigasjon */
          }
        }}
      />
    </>
  );
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-slate-500 text-[18px]">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className={`text-slate-900 font-semibold text-sm truncate ${mono ? "font-mono" : ""}`}>
          {value}
        </p>
      </div>
    </div>
  );
}
