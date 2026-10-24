"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { apiFetch, setAuthToken, clearAuthToken, getAuthToken, isFrontendPreview } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  locale: string;
  defaultDestinySystem: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      if (isFrontendPreview()) {
        setUser({
          id: "demo-user",
          email: "preview@echomere.local",
          phone: null,
          name: "妮娜",
          locale: "zh-CN",
          defaultDestinySystem: "bazi",
        });
        setToken("local-preview");
        setLoading(false);
        return;
      }
      const stored = getAuthToken();
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        const res = await apiFetch("/auth/me", {
          headers: { Authorization: `Bearer ${stored}` },
        });
        if (res.ok) {
          const me = await res.json();
          setUser(me);
          setToken(stored);
        } else {
          clearAuthToken();
        }
      } catch (e) {
        console.error("[auth] restore failed", e);
        clearAuthToken();
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const login = (newToken: string, newUser: AuthUser) => {
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    clearAuthToken();
    setToken(null);
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
