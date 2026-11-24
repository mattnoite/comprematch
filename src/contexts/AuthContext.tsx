"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Perfil, UserRole } from "@/types/database";

interface AuthActionResult {
  error: string | null;
  profile?: Perfil | null;
}

interface SignUpResult {
  error: string | null;
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

  const fetchSeqRef = useRef(0);
  const loadedUserIdRef = useRef<string | null>(null);

  const fetchPerfil = useCallback(
    async (targetUser: User | null): Promise<Perfil | null> => {
      const seq = ++fetchSeqRef.current;

      if (!targetUser || !configured) {
        loadedUserIdRef.current = null;
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

        // Ignora resposta antiga se uma requisição mais recente já foi iniciada
        if (seq !== fetchSeqRef.current) return null;

        if (error || !data) {
          if (error) {
            console.error("Erro ao carregar perfil:", error.message);
          }
          const fallback: Perfil = {
            id: targetUser.id,
            email: targetUser.email ?? "",
            role: "consumidor",
          };
          loadedUserIdRef.current = targetUser.id;
          setProfile(fallback);
          return fallback;
        }

        const resolved: Perfil = {
          id: String(data.id),
          email: String(data.email ?? targetUser.email ?? ""),
          role: (data.role as UserRole) ?? "consumidor",
          created_at: data.created_at ?? null,
        };
        loadedUserIdRef.current = targetUser.id;
        setProfile(resolved);
        return resolved;
      } catch (err) {
        if (seq !== fetchSeqRef.current) return null;
        console.error("Falha inesperada ao buscar perfil:", err);
        loadedUserIdRef.current = null;
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
          loadedUserIdRef.current = null;
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
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        loadedUserIdRef.current = null;
        setProfile(null);
        setLoading(false);
        return;
      }

      // Evita refetch/flash redundante quando o perfil desse usuário já está carregado (ex.: TOKEN_REFRESHED ou signIn direto)
      if (
        event === "TOKEN_REFRESHED" ||
        (event === "SIGNED_IN" &&
          loadedUserIdRef.current === nextSession.user.id)
      ) {
        setLoading(false);
        return;
      }

      setLoading(true);
      void fetchPerfil(nextSession.user).finally(() => {
        if (mounted) setLoading(false);
      });
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
          profile: null,
        };
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        return { error: error.message, profile: null };
      }

      setSession(data.session);
      setUser(data.user);
      const resolvedProfile = await fetchPerfil(data.user);
      setLoading(false);

      return { error: null, profile: resolvedProfile };
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
        const { error: upsertError } = await supabase.from("perfis").upsert(
          {
            id: data.user.id,
            email: data.user.email ?? normalizedEmail,
            role: "consumidor" as UserRole,
          },
          { onConflict: "id", ignoreDuplicates: true }
        );

        if (upsertError) {
          console.warn(
            "Aviso ao garantir perfil padrão no cadastro:",
            upsertError.message
          );
        }

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
    loadedUserIdRef.current = null;
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
