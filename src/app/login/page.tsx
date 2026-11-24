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
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type AuthTab = "login" | "signup";

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";

function formatAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "E-mail ou senha inválidos.";
  }
  if (lower.includes("email rate limit exceeded")) {
    return "Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (lower.includes("user already registered")) {
    return "Este e-mail já está cadastrado. Tente acessar pela aba Entrar.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirme seu e-mail para ativar sua conta antes de entrar.";
  }
  return message;
}

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
        const { error, profile: signedProfile } = await signIn(email, password);
        if (error) {
          setErrorMessage(formatAuthError(error));
          return;
        }

        const isStaff =
          signedProfile?.role === "admin" ||
          signedProfile?.role === "colaborador";

        const safeDestination = isStaff
          ? redirectTarget && redirectTarget.startsWith("/admin")
            ? redirectTarget
            : "/admin/upload"
          : "/";

        router.push(safeDestination);
        router.refresh();
      } else {
        const { error, needsEmailConfirmation } = await signUp(
          email,
          password
        );
        if (error) {
          setErrorMessage(formatAuthError(error));
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
    <div className="flex min-h-screen flex-col text-brand-dark">
      {/* Navbar minimalista alinhada à Home */}
      <header className="sticky top-0 z-50 border-b border-[#333029]/10 bg-[#F8F7F4]/90 py-3 backdrop-blur-md sm:py-3.5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              className="shrink-0 font-serif text-xl font-semibold tracking-tight text-brand-dark sm:text-2xl"
              aria-label="CompreMatch — página inicial"
            >
              CompreMatch
            </Link>
            <span className="hidden rounded-md bg-[#EDEAE3] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-taupe sm:inline-block">
              Portal & Conta
            </span>
          </div>

          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#333029]/25 px-3.5 py-1.5 text-xs font-medium text-brand-dark transition-colors hover:border-brand-gold hover:text-brand-gold sm:text-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Voltar à vitrine
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6 sm:py-12">
        {isRestrictedRedirect && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-3 rounded-2xl border border-brand-gold/50 bg-brand-yellow/15 p-4 text-brand-dark"
          >
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-dark"
              aria-hidden="true"
            />
            <div className="text-sm">
              <p className="font-bold">
                Acesso restrito a colaboradores autorizados
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-brand-taupe">
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
            className="mb-5 flex items-start gap-3 rounded-2xl border border-[#333029]/10 bg-white p-4 text-sm text-brand-dark"
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
          <div className="mb-5 rounded-2xl border border-[#333029]/10 bg-white p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={MICRO_LABEL}>Sessão ativa</p>
                <p className="mt-1 truncate text-sm font-semibold text-brand-dark">
                  {user.email}
                </p>
                <span className="mt-1.5 inline-block rounded-md bg-[#F3F1EC] px-2 py-0.5 text-[11px] font-semibold text-brand-taupe">
                  Perfil: {role ?? "consumidor"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-[#333029]/25 px-3 py-1.5 text-xs font-medium text-brand-dark transition-colors hover:border-brand-gold hover:text-brand-gold"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sair
              </button>
            </div>

            {isAuthorizedStaff ? (
              <div className="mt-4 flex flex-col gap-2 border-t border-[#333029]/10 pt-3 sm:flex-row">
                <Link
                  href="/admin/upload"
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-brand-yellow px-3.5 py-2.5 text-xs font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98]"
                >
                  Ir para Upload de Encartes
                </Link>
                {role === "admin" && (
                  <Link
                    href="/admin/usuarios"
                    className="inline-flex items-center justify-center rounded-lg border border-[#333029]/15 bg-[#F8F7F4] px-3.5 py-2.5 text-xs font-semibold text-brand-dark transition-colors hover:border-brand-gold"
                  >
                    Usuários
                  </Link>
                )}
              </div>
            ) : (
              <p className="mt-3 border-t border-[#333029]/10 pt-3 text-xs leading-relaxed text-brand-taupe">
                Sua conta possui perfil{" "}
                <strong className="text-brand-dark">consumidor</strong>. Entre
                com outro usuário ou solicite permissão a um administrador.
              </p>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#333029]/10 bg-white">
          <div className="border-b border-[#333029]/10 px-5 pt-6 pb-5 sm:px-6">
            <p className={MICRO_LABEL}>Acesso CompreMatch</p>
            <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-brand-dark sm:text-3xl">
              {tab === "login"
                ? "Entrar no CompreMatch"
                : "Criar conta no CompreMatch"}
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-brand-taupe">
              {tab === "login"
                ? "Acesse sua conta de colaborador, administrador ou consumidor."
                : "Cadastre-se com e-mail e senha para começar."}
            </p>
          </div>

          <div className="px-5 pt-5 sm:px-6">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#F3F1EC] p-1">
              <button
                id="tab-login"
                type="button"
                onClick={() => {
                  setTab("login");
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors sm:text-sm ${
                  tab === "login"
                    ? "bg-[#333029] text-white"
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
                className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors sm:text-sm ${
                  tab === "signup"
                    ? "bg-[#333029] text-white"
                    : "text-brand-taupe hover:text-brand-dark"
                }`}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Cadastrar
              </button>
            </div>
          </div>

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4 p-5 sm:p-6"
          >
            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
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
                className="flex items-start gap-2 rounded-xl border border-brand-olive/40 bg-[#F3F1EC] p-3 text-xs font-medium text-brand-dark"
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
                className={`mb-1.5 block ${MICRO_LABEL}`}
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
                  className="w-full rounded-lg border border-[#333029]/15 bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className={`mb-1.5 block ${MICRO_LABEL}`}
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
                  className="w-full rounded-lg border border-[#333029]/15 bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                />
              </div>
            </div>

            {tab === "signup" && (
              <div>
                <label
                  htmlFor="auth-confirm-password"
                  className={`mb-1.5 block ${MICRO_LABEL}`}
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
                    className="w-full rounded-lg border border-[#333029]/15 bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={submitting || !configured}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-yellow px-4 py-3 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
        <div className="flex min-h-screen items-center justify-center text-brand-dark">
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
