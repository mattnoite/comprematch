"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Perfil, UserRole } from "@/types/database";

interface AuthActionResult {
  error: string | null;
}

interface SignUpResult extends AuthActionResult {
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Perfil | null;
  role: UserRole | null;
  loading: boolean;
  configured: boolean;
  isAuthorizedStaff: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Perfil | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState<boolean>(configured);

  const fetchPerfil = useCallback(
    async (targetUser: User | null): Promise<Perfil | null> => {
      if (!targetUser || !configured) {
        setProfile(null);
        return null;
      }

      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from("perfis")
          .select("id, email, role, created_at")
          .eq("id", targetUser.id)
          .maybeSingle();

        if (error) {
          console.error("Erro ao carregar perfil:", error.message);
          const fallback: Perfil = {
            id: targetUser.id,
            email: targetUser.email ?? "",
            role: "consumidor",
          };
          setProfile(fallback);
          return fallback;
        }

        if (!data) {
          const fallback: Perfil = {
            id: targetUser.id,
            email: targetUser.email ?? "",
            role: "consumidor",
          };
          setProfile(fallback);
          return fallback;
        }

        const resolved: Perfil = {
          id: String(data.id),
          email: String(data.email ?? targetUser.email ?? ""),
          role: (data.role as UserRole) ?? "consumidor",
          created_at: data.created_at ?? null,
        };
        setProfile(resolved);
        return resolved;
      } catch (err) {
        console.error("Falha inesperada ao buscar perfil:", err);
        setProfile(null);
        return null;
      }
    },
    [configured]
  );

  useEffect(() => {
    if (!configured) {
      return;
    }

    let mounted = true;
    const supabase = getSupabaseClient();

    async function initSession() {
      try {
        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user) {
          await fetchPerfil(initialSession.user);
        } else {
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        setLoading(true);
        void fetchPerfil(nextSession.user).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [configured, fetchPerfil]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      if (!configured) {
        return {
          error:
            "Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        };
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        return { error: error.message };
      }

      setSession(data.session);
      setUser(data.user);
      await fetchPerfil(data.user);

      return { error: null };
    },
    [configured, fetchPerfil]
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<SignUpResult> => {
      if (!configured) {
        return {
          error:
            "Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
          needsEmailConfirmation: false,
        };
      }

      const supabase = getSupabaseClient();
      const normalizedEmail = email.trim();
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });

      if (error) {
        return { error: error.message, needsEmailConfirmation: false };
      }

      const needsEmailConfirmation = Boolean(data.user && !data.session);

      if (data.user && data.session) {
        setSession(data.session);
        setUser(data.user);

        // Garante criação do perfil padrão como 'consumidor' caso não haja trigger no banco
        await supabase.from("perfis").upsert(
          {
            id: data.user.id,
            email: data.user.email ?? normalizedEmail,
            role: "consumidor" as UserRole,
          },
          { onConflict: "id", ignoreDuplicates: true }
        );

        await fetchPerfil(data.user);
      }

      return { error: null, needsEmailConfirmation };
    },
    [configured, fetchPerfil]
  );

  const signOut = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
  }, [configured]);

  const refreshProfile = useCallback(async () => {
    return fetchPerfil(user);
  }, [fetchPerfil, user]);

  const role: UserRole | null = profile?.role ?? null;
  const isAuthorizedStaff = role === "admin" || role === "colaborador";
  const isAdmin = role === "admin";

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      role,
      loading,
      configured,
      isAuthorizedStaff,
      isAdmin,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [
      user,
      session,
      profile,
      role,
      loading,
      configured,
      isAuthorizedStaff,
      isAdmin,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth deve ser utilizado dentro de um AuthProvider.");
  }
  return ctx;
}
