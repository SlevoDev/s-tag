"use client";
import { Suspense, useState, FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { useTranslation } from "../lib/i18n";
import OAuthButtons from "../components/OAuthButtons";

export default function LoginPageWrapper() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}

function LoginPage() {
  const { login } = useAuth();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password, next);
    } catch (err: any) {
      setError(err.message || "Kunne ikke logge inn");
      setLoading(false);
    }
  }

  const registerHref = next ? `/registrer?next=${encodeURIComponent(next)}` : "/registrer";

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-slate-50 to-white">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Link href="/" className="flex items-center justify-center mb-8">
          <Image src="/logo.png" alt="S-TAG" width={120} height={86} className="object-contain" priority />
        </Link>
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-xl">
          <h1 className="text-3xl font-black tracking-tight mb-2 text-center">{t("login.welcome")}</h1>
          <p className="text-slate-500 text-center mb-8">{t("login.subtitle")}</p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">{t("common.email")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0f2a5c] focus:ring-2 focus:ring-[#0f2a5c]/10 transition"
                placeholder={t("login.emailPlaceholder")}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">{t("common.password")}</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0f2a5c] focus:ring-2 focus:ring-[#0f2a5c]/10 transition"
                placeholder={t("login.passwordPlaceholder")}
                autoComplete="current-password"
              />
            </div>
            <div className="flex justify-end">
              <Link href="/glemt-passord" className="text-xs text-[#0f2a5c] font-semibold hover:underline">
                {t("login.forgotPassword")}
              </Link>
            </div>
            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-2xl bg-[#0f2a5c] text-white font-bold text-lg hover:bg-[#1a3d7c] transition disabled:opacity-50 shadow-lg shadow-[#0f2a5c]/20"
            >
              {loading ? t("login.loggingIn") : t("login.login")}
            </button>
          </form>
          <div className="mt-6">
            <OAuthButtons mode="login" redirectTo={next} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">
            {t("login.noAccount")}{" "}
            <Link href={registerHref} className="text-[#0f2a5c] font-bold hover:underline">
              {t("login.createAccount")}
            </Link>
          </p>
        </div>
        <p className="mt-6 text-center">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-600">
            {t("login.backToHome")}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
