"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FileUp,
  Loader2,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, role, loading, isAuthorizedStaff, isAdmin, signOut } =
    useAuth();

  useEffect(() => {
    if (loading) return;

    if (!user || role === "consumidor" || !isAuthorizedStaff) {
      const encodedRedirect = encodeURIComponent(pathname || "/admin/upload");
      router.replace(`/login?reason=restricted&redirect=${encodedRedirect}`);
    }
  }, [loading, user, role, isAuthorizedStaff, pathname, router]);

  if (loading || !user || !isAuthorizedStaff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-brand-dark">
        <Loader2
          className="h-7 w-7 animate-spin text-brand-gold"
          aria-hidden="true"
        />
        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-taupe">
          Verificando credenciais de acesso...
        </p>
      </div>
    );
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen flex-col text-brand-dark">
      <header className="sticky top-0 z-50 border-b border-[#333029]/10 bg-[#F8F7F4]/90 py-3 backdrop-blur-md sm:py-3.5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-4 lg:gap-6">
              <div className="flex min-w-0 items-center gap-2.5">
                <Link
                  href="/"
                  className="shrink-0 font-serif text-xl font-semibold tracking-tight text-brand-dark sm:text-2xl"
                  aria-label="CompreMatch — página inicial"
                >
                  CompreMatch
                </Link>
                <span className="hidden rounded-md bg-[#EDEAE3] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-taupe sm:inline-block">
                  Portal do Lojista
                </span>
              </div>

              <nav
                aria-label="Navegação do Portal do Lojista"
                className="hidden items-center gap-1.5 md:flex"
              >
                <Link
                  href="/admin/upload"
                  aria-current={
                    pathname?.startsWith("/admin/upload") ? "page" : undefined
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    pathname?.startsWith("/admin/upload")
                      ? "bg-[#333029] text-white"
                      : "text-brand-taupe hover:bg-[#EDEAE3] hover:text-brand-dark"
                  }`}
                >
                  <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                  Ingestão de Catálogos
                </Link>

                {isAdmin && (
                  <Link
                    href="/admin/usuarios"
                    aria-current={
                      pathname?.startsWith("/admin/usuarios")
                        ? "page"
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      pathname?.startsWith("/admin/usuarios")
                        ? "bg-[#333029] text-white"
                        : "text-brand-taupe hover:bg-[#EDEAE3] hover:text-brand-dark"
                    }`}
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    Equipe e Acessos
                  </Link>
                )}
              </nav>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 lg:flex">
                <span className="max-w-48 truncate text-xs text-brand-taupe">
                  {user.email}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-[#F3F1EC] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-taupe">
                  <ShieldCheck
                    className="h-3 w-3 text-brand-olive"
                    aria-hidden="true"
                  />
                  {role}
                </span>
              </div>

              <Link
                href="/"
                className="hidden items-center gap-1.5 rounded-full border border-[#333029]/25 px-3.5 py-1.5 text-xs font-medium text-brand-dark transition-colors hover:border-brand-gold hover:text-brand-gold sm:inline-flex"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Vitrine
              </Link>

              <button
                id="admin-logout-btn"
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#EDEAE3] px-3 py-1.5 text-xs font-semibold text-brand-dark transition-colors hover:bg-[#E5E1D8]"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sair
              </button>
            </div>
          </div>

          <nav
            aria-label="Navegação móvel do Portal do Lojista"
            className="no-scrollbar mt-2.5 flex items-center gap-1.5 overflow-x-auto border-t border-[#333029]/10 pt-2.5 md:hidden"
          >
            <Link
              href="/admin/upload"
              aria-current={
                pathname?.startsWith("/admin/upload") ? "page" : undefined
              }
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                pathname?.startsWith("/admin/upload")
                  ? "bg-[#333029] text-white"
                  : "border border-[#333029]/10 bg-white text-brand-dark"
              }`}
            >
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
              Ingestão de Catálogos
            </Link>

            {isAdmin && (
              <Link
                href="/admin/usuarios"
                aria-current={
                  pathname?.startsWith("/admin/usuarios") ? "page" : undefined
                }
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  pathname?.startsWith("/admin/usuarios")
                    ? "bg-[#333029] text-white"
                    : "border border-[#333029]/10 bg-white text-brand-dark"
                }`}
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Equipe e Acessos
              </Link>
            )}

            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#333029]/15 bg-white px-3 py-1.5 text-xs font-medium text-brand-dark sm:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Vitrine
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
