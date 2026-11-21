"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FileUp,
  Loader2,
  LogOut,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function AdminLayout({ children }: { children: ReactNode }) {
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#FAFAF9] text-brand-dark">
        <Loader2
          className="h-7 w-7 animate-spin text-brand-gold"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-brand-taupe">
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
    <div className="flex min-h-screen flex-col bg-[#FAFAF9] text-brand-dark">
      <header className="border-b border-brand-taupe/25 bg-brand-dark text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-yellow text-brand-dark shadow-xs">
                <Store className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white">
                  CompreMatch
                </span>
                <span className="ml-2 rounded-md bg-brand-olive/40 px-2 py-0.5 text-[11px] font-semibold text-brand-yellow">
                  Portal do Lojista
                </span>
              </div>
            </Link>

            <nav aria-label="Navegação do Portal do Lojista" className="flex gap-1.5">
              <Link
                href="/admin/upload"
                aria-current={pathname?.startsWith("/admin/upload") ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  pathname?.startsWith("/admin/upload")
                    ? "bg-brand-yellow text-brand-dark"
                    : "text-white/80 hover:bg-brand-taupe/40 hover:text-white"
                }`}
              >
                <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                Ingestão de Catálogos
              </Link>

              {isAdmin && (
                <Link
                  href="/admin/usuarios"
                  aria-current={pathname?.startsWith("/admin/usuarios") ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    pathname?.startsWith("/admin/usuarios")
                      ? "bg-brand-yellow text-brand-dark"
                      : "text-white/80 hover:bg-brand-taupe/40 hover:text-white"
                  }`}
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  Equipe e Acessos
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-xs text-white/80">{user.email}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-olive/30 px-2.5 py-0.5 text-[11px] font-semibold text-brand-yellow">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {role}
              </span>
            </div>

            <button
              id="admin-logout-btn"
              type="button"
              onClick={() => void handleSignOut()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-brand-taupe px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-taupe/40"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
