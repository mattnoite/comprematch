"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Mail,
  ShieldAlert,
  Store,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type AuthTab = "login" | "signup";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user,
    role,
    loading: authLoading,
    configured,
    isAuthorizedStaff,
    signIn,
    signUp,
    signOut,
  } = useAuth();

  const reason = searchParams.get("reason");
  const redirectTarget = searchParams.get("redirect");
  const isRestrictedRedirect = reason === "restricted";

  const [tab, setTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage("Informe seu e-mail e sua senha para continuar.");
      return;
    }

    if (tab === "signup") {
      if (password.length < 6) {
        setErrorMessage("A senha deve ter no mínimo 6 caracteres.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage("As senhas não conferem.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (tab === "login") {
        const { error } = await signIn(email, password);
        if (error) {
          setErrorMessage(
            error === "Invalid login credentials"
              ? "E-mail ou senha inválidos."
              : error
          );
          return;
        }

        const safeDestination =
          redirectTarget && redirectTarget.startsWith("/admin")
            ? redirectTarget
            : "/admin/upload";
        router.push(safeDestination);
        router.refresh();
      } else {
        const { error, needsEmailConfirmation } = await signUp(
          email,
          password
        );
        if (error) {
          setErrorMessage(error);
          return;
        }

        if (needsEmailConfirmation) {
          setSuccessMessage(
            "Cadastro realizado! Confirme seu e-mail para ativar sua conta antes de entrar."
          );
          setTab("login");
          setPassword("");
          setConfirmPassword("");
        } else {
          setSuccessMessage(
            "Conta criada com sucesso! Se você precisa acessar o painel administrativo, solicite a liberação de perfil a um administrador."
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF9] text-brand-dark">
      <header className="border-b border-brand-taupe/25 bg-brand-dark text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-yellow text-brand-dark">
              <Store className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white">
                CompreMatch
              </span>
              <span className="ml-2 rounded-md bg-brand-olive/40 px-2 py-0.5 text-[11px] font-semibold text-brand-yellow">
                Portal do Lojista
              </span>
            </div>
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-taupe px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-taupe/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Voltar à vitrine
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        {isRestrictedRedirect && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-xl border border-brand-gold bg-brand-yellow/20 p-4 text-brand-dark"
          >
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-dark"
              aria-hidden="true"
            />
            <div className="text-sm">
              <p className="font-bold">
                Acesso restrito a colaboradores autorizados
              </p>
              <p className="mt-0.5 text-xs text-brand-taupe">
                Faça login com uma conta de perfil{" "}
                <strong className="text-brand-dark">colaborador</strong> ou{" "}
                <strong className="text-brand-dark">admin</strong> para acessar
                o painel.
              </p>
            </div>
          </div>
        )}

        {!configured && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-xl border border-brand-taupe bg-white p-4 text-sm text-brand-dark"
          >
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">Supabase não configurado</p>
              <p className="mt-0.5 text-xs text-brand-taupe">
                Configure <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no arquivo{" "}
                <code>.env.local</code>.
              </p>
            </div>
          </div>
        )}

        {!authLoading && user && (
          <div className="mb-5 rounded-xl border border-brand-taupe bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-brand-taupe">
                  Sessão ativa
                </p>
                <p className="text-sm font-semibold text-brand-dark">
                  {user.email}
                </p>
                <span className="mt-1 inline-block rounded-md bg-brand-olive/15 px-2 py-0.5 text-xs font-semibold text-brand-olive">
                  Perfil: {role ?? "consumidor"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-taupe px-3 py-1.5 text-xs font-semibold text-brand-dark transition-colors hover:bg-brand-yellow/15"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sair
              </button>
            </div>

            {isAuthorizedStaff ? (
              <div className="mt-3 flex gap-2 border-t border-brand-taupe/25 pt-3">
                <Link
                  href="/admin/upload"
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-brand-yellow px-3 py-2 text-xs font-bold text-brand-dark transition-colors hover:bg-brand-gold"
                >
                  Ir para Upload de Encartes
                </Link>
                {role === "admin" && (
                  <Link
                    href="/admin/usuarios"
                    className="inline-flex items-center justify-center rounded-lg border border-brand-taupe px-3 py-2 text-xs font-semibold text-brand-dark transition-colors hover:bg-brand-yellow/10"
                  >
                    Usuários
                  </Link>
                )}
              </div>
            ) : (
              <p className="mt-2.5 text-xs text-brand-taupe">
                Sua conta possui perfil <strong>consumidor</strong>. Entre com
                outro usuário ou solicite permissão a um administrador.
              </p>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-brand-taupe bg-white shadow-sm">
          <div className="bg-brand-dark px-6 py-5 text-white">
            <h1 className="text-xl font-bold tracking-tight">
              {tab === "login"
                ? "Entrar no CompreMatch"
                : "Criar conta no CompreMatch"}
            </h1>
            <p className="mt-1 text-xs text-white/75">
              {tab === "login"
                ? "Acesse sua conta de colaborador, administrador ou consumidor."
                : "Cadastre-se com e-mail e senha para começar."}
            </p>
          </div>

          <div className="grid grid-cols-2 border-b border-brand-taupe/40 bg-[#faf7ef] p-1.5">
            <button
              id="tab-login"
              type="button"
              onClick={() => {
                setTab("login");
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
                tab === "login"
                  ? "bg-brand-dark text-brand-yellow"
                  : "text-brand-taupe hover:text-brand-dark"
              }`}
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Entrar
            </button>
            <button
              id="tab-signup"
              type="button"
              onClick={() => {
                setTab("signup");
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
                tab === "signup"
                  ? "bg-brand-dark text-brand-yellow"
                  : "text-brand-taupe hover:text-brand-dark"
              }`}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Cadastrar
            </button>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-6">
            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs font-medium text-red-800"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-brand-olive bg-brand-olive/10 p-3 text-xs font-medium text-brand-dark"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-olive"
                  aria-hidden="true"
                />
                <span>{successMessage}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-dark"
              >
                E-mail
              </label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-taupe"
                  aria-hidden="true"
                />
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colaborador@comprematch.com.br"
                  className="w-full rounded-xl border border-brand-taupe bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-dark"
              >
                Senha
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-taupe"
                  aria-hidden="true"
                />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={
                    tab === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-brand-taupe bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                />
              </div>
            </div>

            {tab === "signup" && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-brand-dark"
                >
                  Confirmar Senha
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-taupe"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-confirm-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-brand-taupe bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={submitting || !configured}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-yellow px-4 py-3 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {tab === "login" ? "Entrando..." : "Cadastrando..."}
                </>
              ) : tab === "login" ? (
                <>
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Entrar
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Criar Conta
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#fcfaf5] text-brand-dark">
          <Loader2
            className="h-6 w-6 animate-spin text-brand-gold"
            aria-hidden="true"
          />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
