"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { auth, setToken, getToken, User } from "./api";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, redirectTo?: string) => Promise<void>;
  register: (email: string, password: string, name: string, redirectTo?: string) => Promise<void>;
  loginWithOAuth: (
    provider: "google" | "apple",
    idToken: string,
    name?: string,
    acceptTerms?: boolean,
    redirectTo?: string
  ) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: User | null) => void;
};

// Bare tillat interne stier — hindrer åpen redirect-angrep hvor en lenke
// i f.eks. en tag kan peke et innlogget offer til en ekstern phishing-side.
function sanitizeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  return raw;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_ROUTES = [
  "/",
  "/logg-inn",
  "/registrer",
  "/glemt-passord",
  "/tilbakestill-passord",
  "/om",
  "/personvern",
  "/vilkar",
  "/kontakt",
];
const PUBLIC_PREFIXES = ["/funnet/"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    auth
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // Client-side route guard
  useEffect(() => {
    if (loading) return;
    const isPublic =
      PUBLIC_ROUTES.includes(pathname) ||
      PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    if (!user && !isPublic) {
      const next = `${pathname}${typeof window !== "undefined" ? window.location.search : ""}`;
      const safeNext = sanitizeRedirect(next);
      router.replace(safeNext ? `/logg-inn?next=${encodeURIComponent(safeNext)}` : "/logg-inn");
    }
  }, [user, loading, pathname, router]);

  const refreshUser = async () => {
    try {
      const res = await auth.me();
      setUser(res.user);
    } catch {
      /* stille */
    }
  };

  const login = async (email: string, password: string, redirectTo?: string) => {
    const { token, user } = await auth.login(email, password);
    setToken(token);
    setUser(user);
    router.replace(sanitizeRedirect(redirectTo) || "/hjem");
  };

  const register = async (email: string, password: string, name: string, redirectTo?: string) => {
    const { token, user } = await auth.register(email, password, name);
    setToken(token);
    setUser(user);
    router.replace(sanitizeRedirect(redirectTo) || "/hjem");
  };

  const loginWithOAuth = async (
    provider: "google" | "apple",
    idToken: string,
    name?: string,
    acceptTerms = false,
    redirectTo?: string
  ) => {
    const { token, user } = await auth.oauth(provider, idToken, name, acceptTerms);
    setToken(token);
    setUser(user);
    router.replace(sanitizeRedirect(redirectTo) || "/hjem");
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    router.replace("/");
  };

  // Vis en loading-splash mens vi sjekker om brukeren er innlogget
  if (loading) {
    const isPublic =
      PUBLIC_ROUTES.includes(pathname) ||
      PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    // Offentlige sider vises direkte (landing, login, registrer)
    if (!isPublic) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-white">
          <div className="w-10 h-10 rounded-xl bg-[#0f2a5c]/5 flex items-center justify-center mb-4 animate-pulse">
            <span
              className="material-symbols-outlined text-[#0f2a5c] text-2xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              shield
            </span>
          </div>
          <div className="h-1 w-24 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-[#0f2a5c]/40 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]"
              style={{ animation: "pulse 1.5s ease-in-out infinite" }}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, loginWithOAuth, logout, refreshUser, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
