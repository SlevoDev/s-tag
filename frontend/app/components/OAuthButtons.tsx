"use client";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context";
import { auth as authApi, setToken, User } from "../lib/api";
import { useToast } from "./Toast";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || "";
const APPLE_REDIRECT_URI =
  process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI ||
  (typeof window !== "undefined" ? window.location.origin : "");

declare global {
  interface Window {
    google?: any;
    AppleID?: any;
  }
}

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return resolve();
    if (document.getElementById(id)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.id = id;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Kunne ikke laste ${src}`));
    document.head.appendChild(s);
  });
}

export default function OAuthButtons({
  mode,
  requireAccept = false,
  accepted = true,
  onRegistered,
  redirectTo,
}: {
  mode: "login" | "register";
  requireAccept?: boolean;
  accepted?: boolean;
  /** Når satt (og mode="register") overtar forelder navigasjonen etter OAuth —
   *  brukes f.eks. for å vise posisjons-samtykke-steget før vi går til /hjem. */
  onRegistered?: (user: User) => void;
  /** Intern sti å navigere til etter vellykket login (default /hjem). */
  redirectTo?: string;
}) {
  const { loginWithOAuth, setUser } = useAuth();
  const toast = useToast();
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<"google" | "apple" | null>(null);
  const blocked = requireAccept && !accepted;
  const googleConfigured = !!GOOGLE_CLIENT_ID;
  const appleConfigured = !!APPLE_CLIENT_ID;
  const anyConfigured = googleConfigured || appleConfigured;

  // Register-flyten bruker onRegistered slik at forelder (registrer/page.tsx)
  // kan vise posisjons-samtykke-steget. Vi kaller authApi.oauth direkte og
  // hopper over auth-context.loginWithOAuth som ellers redirecter til /hjem.
  async function runOAuth(
    provider: "google" | "apple",
    idToken: string,
    name?: string
  ) {
    if (mode === "register" && onRegistered) {
      const { token, user } = await authApi.oauth(provider, idToken, name, accepted);
      setToken(token);
      setUser(user);
      onRegistered(user);
    } else {
      await loginWithOAuth(provider, idToken, name, accepted, redirectTo);
    }
  }

  // Google Identity Services
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleBtnRef.current) return;
    let cancelled = false;
    loadScript("https://accounts.google.com/gsi/client", "google-gsi")
      .then(() => {
        if (cancelled || !window.google || !googleBtnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (resp: { credential: string }) => {
            if (blocked) {
              toast.error("Du må godta vilkårene og personvernerklæringen først.");
              return;
            }
            setBusy("google");
            try {
              await runOAuth("google", resp.credential, undefined);
            } catch (err: any) {
              toast.error(err.message || "Google-innlogging feilet");
            } finally {
              setBusy(null);
            }
          },
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          type: "standard",
          text: mode === "login" ? "signin_with" : "signup_with",
          shape: "pill",
          logo_alignment: "center",
          width: 320,
        });
      })
      .catch(() => {
        /* stille — fallback-knapp nedenfor vises uansett */
      });
    return () => {
      cancelled = true;
    };
  }, [loginWithOAuth, toast, mode]);

  const handleApple = async () => {
    if (blocked) {
      toast.error("Du må godta vilkårene og personvernerklæringen først.");
      return;
    }
    if (!APPLE_CLIENT_ID) {
      toast.error("Apple-innlogging er ikke konfigurert enda");
      return;
    }
    setBusy("apple");
    try {
      await loadScript(
        "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js",
        "apple-id-sdk"
      );
      if (!window.AppleID) throw new Error("Apple SDK lastet ikke");
      window.AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: "name email",
        redirectURI: APPLE_REDIRECT_URI,
        usePopup: true,
      });
      const result = await window.AppleID.auth.signIn();
      const idToken = result?.authorization?.id_token;
      if (!idToken) throw new Error("Ingen id_token fra Apple");
      const appleName = result?.user
        ? [result.user.name?.firstName, result.user.name?.lastName].filter(Boolean).join(" ")
        : undefined;
      await runOAuth("apple", idToken, appleName);
    } catch (err: any) {
      if (err?.error !== "popup_closed_by_user") {
        toast.error(err?.message || "Apple-innlogging feilet");
      }
    } finally {
      setBusy(null);
    }
  };

  // Hvis ingen OAuth-provider er konfigurert — skjul hele seksjonen helt
  // i stedet for å vise tomme/grå knapper. Brukeren bruker da e-post + passord
  // som eneste innloggingsmetode, som er den fullt støttede flyten.
  if (!anyConfigured) return null;

  return (
    <div className={`space-y-3 ${blocked ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-3 text-xs text-slate-400 font-semibold">
        <div className="flex-1 h-px bg-slate-200" />
        <span>eller fortsett med</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Google — native GIS-knapp rendres her når client_id er satt */}
      {googleConfigured && (
        <div className="flex justify-center min-h-[44px]">
          <div ref={googleBtnRef} aria-busy={busy === "google"} />
        </div>
      )}

      {/* Apple */}
      {appleConfigured && (
        <button
          type="button"
          onClick={handleApple}
          disabled={busy === "apple"}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-full bg-black text-white font-semibold hover:bg-slate-800 transition disabled:opacity-60"
        >
          <AppleIcon />
          {busy === "apple" ? "Kobler til…" : "Fortsett med Apple"}
        </button>
      )}
    </div>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
