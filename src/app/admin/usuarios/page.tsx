"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  UserCheck,
  Users,
} from "lucide-react";
import { Toast, type ToastMessage } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Perfil, UserRole } from "@/types/database";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "consumidor", label: "Consumidor" },
  { value: "colaborador", label: "Colaborador" },
  { value: "admin", label: "Admin" },
];

function formatDate(isoDate?: string | null): string {
  if (!isoDate) return "—";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getRoleBadgeClasses(role: UserRole): string {
  switch (role) {
    case "admin":
      return "border border-brand-dark bg-brand-dark text-brand-yellow";
    case "colaborador":
      return "border border-brand-olive bg-brand-olive/20 text-brand-dark";
    case "consumidor":
    default:
      return "border border-brand-taupe/40 bg-brand-taupe/10 text-brand-taupe";
  }
}

export default function AdminUsuariosPage() {
  const { user: currentUser, isAdmin, loading: authLoading } = useAuth();

  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback(
    (type: ToastMessage["type"], title: string, description?: string) => {
      setToast({ id: Date.now(), type, title, description });
    },
    []
  );

  const fetchPerfisFromSupabase = useCallback(async (): Promise<{
    data: Perfil[];
    error: string | null;
  }> => {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("perfis")
        .select("id, email, role, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        const fallback = await supabase
          .from("perfis")
          .select("id, email, role")
          .order("email", { ascending: true });

        if (fallback.error) {
          return { data: [], error: fallback.error.message };
        }

        return { data: (fallback.data as Perfil[]) ?? [], error: null };
      }

      return { data: (data as Perfil[]) ?? [], error: null };
    } catch (err) {
      return {
        data: [],
        error: err instanceof Error ? err.message : "Erro ao listar usuários.",
      };
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setErrorList(null);
    setLoadingList(true);
    const result = await fetchPerfisFromSupabase();
    setPerfis(result.data);
    setErrorList(result.error);
    setLoadingList(false);
  }, [fetchPerfisFromSupabase]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;

    let active = true;
    void fetchPerfisFromSupabase().then((result) => {
      if (!active) return;
      setPerfis(result.data);
      setErrorList(result.error);
      setLoadingList(false);
    });

    return () => {
      active = false;
    };
  }, [authLoading, isAdmin, fetchPerfisFromSupabase]);

  async function handleRoleChange(targetPerfil: Perfil, nextRole: UserRole) {
    if (targetPerfil.role === nextRole) return;
    if (targetPerfil.id === currentUser?.id && nextRole !== "admin") {
      showToast(
        "error",
        "Ação bloqueada",
        "Você não pode remover sua própria permissão de administrador."
      );
      return;
    }

    const previousRole = targetPerfil.role;
    setUpdatingId(targetPerfil.id);

    setPerfis((prev) =>
      prev.map((p) =>
        p.id === targetPerfil.id ? { ...p, role: nextRole } : p
      )
    );

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("perfis")
        .update({ role: nextRole })
        .eq("id", targetPerfil.id);

      if (error) {
        setPerfis((prev) =>
          prev.map((p) =>
            p.id === targetPerfil.id ? { ...p, role: previousRole } : p
          )
        );
        showToast(
          "error",
          "Falha ao atualizar permissão",
          error.message
        );
        return;
      }

      showToast(
        "success",
        "Permissão atualizada",
        `${targetPerfil.email} agora possui perfil "${nextRole}".`
      );
    } catch (err) {
      setPerfis((prev) =>
        prev.map((p) =>
          p.id === targetPerfil.id ? { ...p, role: previousRole } : p
        )
      );
      showToast(
        "error",
        "Erro inesperado",
        err instanceof Error ? err.message : "Não foi possível salvar."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const filteredPerfis = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return perfis.filter((p) => {
      const matchesSearch =
        !query || p.email.toLowerCase().includes(query);
      const matchesRole = roleFilter === "all" || p.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [perfis, searchTerm, roleFilter]);

  if (!authLoading && !isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-brand-taupe bg-white p-8 text-center shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-yellow/25 text-brand-dark">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-brand-dark">
          Acesso exclusivo para administradores
        </h1>
        <p className="mt-2 text-sm text-brand-taupe">
          Seu perfil atual permite enviar e revisar encartes, mas apenas
          usuários com role <strong>admin</strong> podem alterar permissões.
        </p>
        <Link
          href="/admin/upload"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-yellow px-5 py-2.5 text-sm font-bold text-brand-dark transition-colors hover:bg-brand-gold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para Upload de Encartes
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-olive/15 px-2.5 py-1 text-xs font-semibold text-brand-olive">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              Controle de Acesso (RBAC)
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-brand-dark">
            Gestão de Usuários e Permissões
          </h1>
          <p className="mt-1 text-sm text-brand-taupe">
            Gerencie quem pode acessar o painel de ingestão de encartes ou
            administrar contas na tabela{" "}
            <code className="font-mono text-xs text-brand-olive">perfis</code>.
          </p>
        </div>

        <button
          id="refresh-users-btn"
          type="button"
          onClick={() => void handleRefresh()}
          disabled={loadingList}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-4 py-2.5 text-sm font-bold text-brand-dark transition-colors hover:bg-brand-gold disabled:opacity-60"
        >
          <RefreshCw
            className={`h-4 w-4 ${loadingList ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Atualizar Lista
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-taupe bg-white p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-taupe"
            aria-hidden="true"
          />
          <input
            id="search-users-input"
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por e-mail..."
            className="w-full rounded-lg border border-brand-taupe py-2 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/40 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "admin", "colaborador", "consumidor"] as const).map(
            (filterValue) => (
              <button
                key={filterValue}
                type="button"
                onClick={() => setRoleFilter(filterValue)}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  roleFilter === filterValue
                    ? "bg-brand-dark text-brand-yellow"
                    : "border border-brand-taupe/50 bg-[#faf7ef] text-brand-taupe hover:text-brand-dark"
                }`}
              >
                {filterValue === "all" ? "Todos" : filterValue}
              </button>
            )
          )}
        </div>
      </div>

      {errorList && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">Erro ao carregar usuários</p>
            <p className="text-xs">{errorList}</p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-brand-taupe bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-brand-taupe bg-brand-dark text-xs font-semibold uppercase tracking-wider text-white">
                <th className="px-5 py-3.5">Usuário (E-mail)</th>
                <th className="px-5 py-3.5">Role Atual</th>
                <th className="px-5 py-3.5">Data de Criação</th>
                <th className="px-5 py-3.5 text-right">Alterar Permissão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-taupe/30">
              {loadingList ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-5 py-12 text-center text-brand-taupe"
                  >
                    <div className="inline-flex items-center gap-2">
                      <Loader2
                        className="h-5 w-5 animate-spin text-brand-gold"
                        aria-hidden="true"
                      />
                      Carregando usuários cadastrados...
                    </div>
                  </td>
                </tr>
              ) : filteredPerfis.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-5 py-12 text-center text-brand-taupe"
                  >
                    <Users
                      className="mx-auto mb-2 h-6 w-6 text-brand-taupe/70"
                      aria-hidden="true"
                    />
                    Nenhum usuário encontrado com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredPerfis.map((perfil) => {
                  const isSelf = perfil.id === currentUser?.id;
                  const isBusy = updatingId === perfil.id;

                  return (
                    <tr
                      key={perfil.id}
                      className="transition-colors hover:bg-[#fcfaf5]"
                    >
                      <td className="px-5 py-4 font-medium text-brand-dark">
                        <div className="flex items-center gap-2">
                          <UserCheck
                            className="h-4 w-4 shrink-0 text-brand-olive"
                            aria-hidden="true"
                          />
                          <span>{perfil.email}</span>
                          {isSelf && (
                            <span className="rounded-md bg-brand-yellow/25 px-2 py-0.5 text-[11px] font-bold text-brand-dark">
                              Você
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeClasses(
                            perfil.role
                          )}`}
                        >
                          {perfil.role}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-xs text-brand-taupe">
                        {formatDate(perfil.created_at)}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <div
                            role="group"
                            aria-label={`Alternar role de ${perfil.email}`}
                            className="inline-flex rounded-lg border border-brand-taupe bg-[#faf7ef] p-0.5"
                          >
                            {ROLE_OPTIONS.map((opt) => {
                              const active = perfil.role === opt.value;
                              const disabledSelf =
                                isSelf && opt.value !== "admin";

                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  disabled={isBusy || disabledSelf}
                                  onClick={() =>
                                    void handleRoleChange(perfil, opt.value)
                                  }
                                  className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                    active
                                      ? "bg-brand-yellow text-brand-dark shadow-xs"
                                      : "text-brand-taupe hover:text-brand-dark"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                          {isBusy && (
                            <Loader2
                              className="h-4 w-4 animate-spin text-brand-gold"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
