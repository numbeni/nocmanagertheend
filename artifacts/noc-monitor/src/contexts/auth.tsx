import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type UserRole = "founder" | "admin" | "operator" | "viewer";

export interface AuthUser {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string;
  username: string;
  role: UserRole;
  isFounder: boolean;
  status: "active" | "inactive";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  presenceStatus: "online" | "offline" | "away" | "busy" | null;
  workStatus: "in_shift" | "off_shift" | "break" | "busy" | "available" | null;
  lastSeenAt: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  setupRequired: boolean | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  setup: (data: {
    firstName: string;
    lastName: string;
    displayName?: string;
    email: string;
    username: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string> ?? {}),
    },
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  const checkSetupStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await apiFetch("/auth/setup-status");
      if (res.ok) {
        const data = await res.json() as { setupRequired: boolean };
        setSetupRequired(data.setupRequired);
        return data.setupRequired;
      }
    } catch {}
    setSetupRequired(false);
    return false;
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch("/auth/me");
      if (res.ok) {
        const data = await res.json() as { user: AuthUser };
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      const needsSetup = await checkSetupStatus();
      if (!needsSetup) {
        await refreshUser();
      } else {
        setLoading(false);
      }
    }
    init();
  }, [checkSetupStatus, refreshUser]);

  useEffect(() => {
    if (!user) return;
    const sendHeartbeat = () => {
      apiFetch("/auth/heartbeat", { method: "POST" }).catch(() => {});
    };
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, 30_000);
    return () => clearInterval(id);
  }, [user]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        return { ok: false, error: err.message ?? "Invalid username/email or password." };
      }
      const data = await res.json() as { user: AuthUser };
      setUser(data.user);
      setSetupRequired(false);
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please try again." };
    }
  }, []);

  const setup = useCallback(async (formData: {
    firstName: string;
    lastName: string;
    displayName?: string;
    email: string;
    username: string;
    password: string;
  }) => {
    try {
      const res = await apiFetch("/auth/setup", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        return { ok: false, error: err.message ?? "Setup failed" };
      }
      const data = await res.json() as { user: AuthUser };
      setUser(data.user);
      setSetupRequired(false);
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please try again." };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setupRequired, login, setup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useAuthFetch() {
  return useCallback(async (path: string, options?: RequestInit) => {
    return apiFetch(path, options);
  }, []);
}
