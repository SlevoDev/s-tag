"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import TopBar from "../../components/TopBar";
import PhotoPicker from "../../components/PhotoPicker";
import { items as itemsApi, API_BASE } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { useGeolocation, hasGeoConsent } from "../../lib/use-geolocation";
import { useTranslation } from "../../lib/i18n";

export default function NyGjenstandPageWrapper() {
  return (
    <Suspense fallback={null}>
      <NyGjenstandPage />
    </Suspense>
  );
}

function NyGjenstandPage() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const prefilledUid = (searchParams.get("chipUid") || "").trim().toUpperCase();

  const CATEGORIES = [
    { id: "electronics", label: t("kartotekNy.catElectronics"), icon: "devices" },
    { id: "bike", label: t("kartotekNy.catBike"), icon: "pedal_bike" },
    { id: "vehicle", label: t("kartotekNy.catVehicle"), icon: "directions_car" },
    { id: "clothing", label: t("kartotekNy.catClothing"), icon: "checkroom" },
    { id: "sport", label: t("kartotekNy.catSport"), icon: "downhill_skiing" },
    { id: "bag", label: t("kartotekNy.catBag"), icon: "backpack" },
    { id: "tools", label: t("kartotekNy.catTools"), icon: "construction" },
    { id: "jewellery", label: t("kartotekNy.catJewellery"), icon: "diamond" },
    { id: "instrument", label: t("kartotekNy.catInstrument"), icon: "piano" },
    { id: "art", label: t("kartotekNy.catArt"), icon: "palette" },
    { id: "furniture", label: t("kartotekNy.catFurniture"), icon: "chair" },
    { id: "document", label: t("kartotekNy.catDocument"), icon: "description" },
    { id: "other", label: t("kartotekNy.catOther"), icon: "category" },
  ];
  const router = useRouter();
  const toast = useToast();
  const geo = useGeolocation(true);
  const [loading, setLoading] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const [stagCode, setStagCode] = useState(prefilledUid);
  const [codeStatus, setCodeStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("electronics");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [valueNok, setValueNok] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");

  useEffect(() => {
    const trimmed = stagCode.trim().toUpperCase();
    if (!trimmed) {
      setCodeStatus("idle");
      return;
    }
    if (trimmed.length < 6) {
      setCodeStatus("invalid");
      return;
    }
    setCodeStatus("checking");
    const t = setTimeout(async () => {
      try {
        const token =
          typeof window !== "undefined"
            ? localStorage.getItem("stag_token")
            : null;
        const r = await fetch(
          `${API_BASE}/api/items/code-available?code=${encodeURIComponent(trimmed)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        const j = await r.json();
        setCodeStatus(j.available ? "available" : "taken");
      } catch {
        setCodeStatus("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [stagCode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("kartotekNy.nameRequired"));
      return;
    }
    const code = stagCode.trim().toUpperCase();
    if (code) {
      if (code.length < 6) {
        toast.error(t("kartotekNy.codeInvalid"));
        return;
      }
      if (codeStatus === "taken") {
        toast.error(t("kartotekNy.codeTaken"));
        return;
      }
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        category,
        description: description.trim() || undefined,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        color: color.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        valueNok: valueNok ? Number(valueNok) : undefined,
        purchasedAt: purchasedAt || undefined,
        photoUrl: photoUrl || undefined,
        receiptUrl: receiptUrl || undefined,
      };
      if (code) {
        payload.chipUid = code;
      }
      if (hasGeoConsent() && geo.lat != null && geo.lng != null) {
        payload.lat = geo.lat;
        payload.lng = geo.lng;
      }
      const created = await itemsApi.create(
        payload as Parameters<typeof itemsApi.create>[0]
      );
      toast.success(t("kartotekNy.registered", created.name));
      router.replace(`/kartotek/detalj?id=${created.id}`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Kunne ikke registrere";
      toast.error(msg);
      setLoading(false);
    }
  };

  const codeValid = !stagCode.trim() || (stagCode.trim().length >= 6 && codeStatus !== "taken" && codeStatus !== "invalid");
  const canSubmit = !!name.trim() && codeValid;

  return (
    <>
      <TopBar showBack title={t("kartotekNy.title")} />

      {/* ── Branded header ── */}
      <div className="bg-[#0f2a5c] pt-28 pb-14 px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl mx-auto"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <span
                className="material-symbols-outlined text-white/80 text-xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                shield
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
              {t("kartotekNy.nationalRegistry")}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            {t("kartotekNy.title")}
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            {t("kartotekNy.subtitle")}
          </p>
        </motion.div>
      </div>

      {/* ── Form ── */}
      <main className="px-6 pb-40 -mt-6 relative z-10">
        <form onSubmit={submit} className="max-w-2xl mx-auto space-y-4">
          {/* Grunnleggende — overlapper navy/hvit */}
          <div className="bg-white rounded-2xl p-5 shadow-lg border border-slate-200 space-y-4">
            <Input
              label={t("common.name")}
              value={name}
              onChange={setName}
              placeholder={t("kartotekNy.namePlaceholder")}
              required
            />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                {t("kartotekNy.category")}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 border transition ${
                      category === c.id
                        ? "bg-[#0f2a5c] text-white border-[#0f2a5c]"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">
                      {c.icon}
                    </span>
                    <span className="text-[9px] font-bold text-center leading-tight px-1">
                      {c.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <PhotoPicker value={photoUrl} onChange={setPhotoUrl} />
          </div>

          {/* Kvittering / dokumentasjon */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-[#0f2a5c] text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {t("kartotekNy.receipt")}
                </p>
                <p className="text-[11px] text-slate-400 leading-snug">{t("kartotekNy.receiptHint")}</p>
              </div>
            </div>
            <PhotoPicker value={receiptUrl} onChange={setReceiptUrl} />
          </div>

          {/* S-TAG-kode (valgfri) */}
          <div
            className={`bg-white rounded-2xl p-5 shadow-sm space-y-3 border transition-colors ${
              codeStatus === "available"
                ? "border-emerald-300"
                : codeStatus === "taken" || codeStatus === "invalid"
                ? "border-red-300"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                  codeStatus === "available"
                    ? "bg-emerald-50"
                    : "bg-slate-50"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-lg transition-colors ${
                    codeStatus === "available"
                      ? "text-emerald-600"
                      : "text-[#0f2a5c]"
                  }`}
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {codeStatus === "available" ? "verified" : "qr_code_2"}
                </span>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {t("kartotekNy.stagCode")} <span className="text-slate-300 normal-case font-semibold">({t("common.optional")})</span>
                </p>
                <p className="text-[11px] text-slate-400 leading-snug">{t("kartotekNy.stagCodeHint")}</p>
              </div>
            </div>
            <input
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={stagCode}
              onChange={(e) => setStagCode(e.target.value.toUpperCase())}
              placeholder="ST-XXXX-XXXX"
              className={`w-full font-mono text-lg tracking-wider bg-slate-50 border rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition ${
                codeStatus === "available"
                  ? "border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/10"
                  : codeStatus === "taken" || codeStatus === "invalid"
                  ? "border-red-400 focus:border-red-500 focus:ring-red-500/10"
                  : "border-slate-200 focus:border-[#0f2a5c] focus:ring-[#0f2a5c]/10"
              }`}
            />
            <div className="text-xs h-5">
              {codeStatus === "checking" && (
                <span className="text-slate-400">{t("kartotekNy.checking")}</span>
              )}
              {codeStatus === "available" && (
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">
                    check_circle
                  </span>
                  {t("kartotekNy.available")}
                </span>
              )}
              {codeStatus === "taken" && (
                <span className="text-red-600 font-semibold">
                  {t("kartotekNy.taken")}
                </span>
              )}
              {codeStatus === "invalid" && (
                <span className="text-red-600 font-semibold">
                  {t("kartotekNy.tooShort")}
                </span>
              )}
            </div>
          </div>

          {/* Flere detaljer */}
          <button
            type="button"
            onClick={() => setShowMore(!showMore)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition"
          >
            <motion.span
              animate={{ rotate: showMore ? 180 : 0 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="material-symbols-outlined text-sm"
            >
              expand_more
            </motion.span>
            {showMore ? t("kartotekNy.hideDetails") : t("kartotekNy.moreDetails")}
          </button>

          <AnimatePresence initial={false}>
          {showMore && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{
                height: "auto",
                opacity: 1,
                transition: {
                  height: { duration: 0.4, ease: [0.32, 0.72, 0, 1] },
                  opacity: { duration: 0.3, delay: 0.08 },
                },
              }}
              exit={{
                height: 0,
                opacity: 0,
                transition: {
                  height: { duration: 0.3, ease: [0.32, 0.72, 0, 1] },
                  opacity: { duration: 0.15 },
                },
              }}
              style={{ overflow: "hidden" }}
            >
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <Textarea
                label={t("kartotekNy.description")}
                value={description}
                onChange={setDescription}
                placeholder={t("kartotekNy.descPlaceholder")}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t("kartotekNy.brand")}
                  value={brand}
                  onChange={setBrand}
                  placeholder="Apple"
                />
                <Input
                  label={t("kartotekNy.model")}
                  value={model}
                  onChange={setModel}
                  placeholder="MBP14 M3"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t("kartotekNy.color")}
                  value={color}
                  onChange={setColor}
                  placeholder="Space Grey"
                />
                <Input
                  label={t("kartotekNy.serialNumber")}
                  value={serialNumber}
                  onChange={setSerialNumber}
                  placeholder="SN123…"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t("kartotekNy.value")}
                  type="number"
                  value={valueNok}
                  onChange={setValueNok}
                  placeholder="25000"
                />
                <Input
                  label={t("kartotekNy.purchaseDate")}
                  type="date"
                  value={purchasedAt}
                  onChange={setPurchasedAt}
                />
              </div>
            </div>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Registrer */}
          <div className="sticky bottom-24 pt-4">
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full py-4 rounded-2xl bg-[#0f2a5c] text-white font-bold text-lg hover:bg-[#1a3d7c] transition disabled:opacity-50 shadow-lg shadow-[#0f2a5c]/20"
            >
              {loading ? t("kartotekNy.registering") : t("kartotekNy.register")}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0f2a5c] focus:ring-2 focus:ring-[#0f2a5c]/10 transition"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0f2a5c] focus:ring-2 focus:ring-[#0f2a5c]/10 transition resize-none"
      />
    </label>
  );
}
