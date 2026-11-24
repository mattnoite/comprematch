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

const MICRO_LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-brand-taupe";
const NUM = "font-mono tabular-nums tracking-tight";

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
      return "border border-[#333029] bg-[#333029] text-brand-yellow";
    case "colaborador":
      return "border border-brand-gold/50 bg-brand-yellow/15 text-brand-dark";
    case "consumidor":
    default:
      return "border border-[#333029]/10 bg-[#F3F1EC] text-brand-taupe";
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
      <div className="mx-auto max-w-lg rounded-2xl border border-[#333029]/10 bg-white p-6 text-center sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F3F1EC] text-brand-dark">
          <ShieldAlert className="h-6 w-6 text-brand-olive" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-brand-dark">
          Acesso exclusivo para administradores
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-taupe">
          Seu perfil atual permite enviar e revisar encartes, mas apenas
          usuários com role <strong>admin</strong> podem alterar permissões.
        </p>
        <Link
          href="/admin/upload"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-yellow px-5 py-2.5 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para Upload de Encartes
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#EDEAE3] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-taupe">
            <Shield className="h-3 w-3 text-brand-olive" aria-hidden="true" />
            Portal do Lojista
          </span>
          <h1 className="mt-2.5 font-serif text-3xl font-semibold tracking-tight text-brand-dark sm:text-4xl">
            Equipe e Permissões de Acesso
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-taupe">
            Gerencie quem pode publicar catálogos promocionais ou administrar
            contas da sua operação.
          </p>
        </div>

        <button
          id="refresh-users-btn"
          type="button"
          onClick={() => void handleRefresh()}
          disabled={loadingList}
          className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-yellow px-4 py-2.5 text-sm font-bold text-brand-dark transition-all hover:bg-brand-gold active:scale-[0.98] disabled:opacity-60 sm:w-auto"
        >
          <RefreshCw
            className={`h-4 w-4 ${loadingList ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Atualizar Lista
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-[#333029]/10 bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="relative min-w-0 flex-1">
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
            className="w-full rounded-lg border border-[#333029]/15 bg-white py-2.5 pr-3 pl-9 text-sm text-brand-dark placeholder:text-brand-taupe/60 focus:border-brand-gold focus:ring-2 focus:ring-brand-yellow/30 focus:outline-none"
          />
        </div>

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5 md:pb-0">
          {(["all", "admin", "colaborador", "consumidor"] as const).map(
            (filterValue) => (
              <button
                key={filterValue}
                type="button"
                onClick={() => setRoleFilter(filterValue)}
                className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  roleFilter === filterValue
                    ? "bg-[#333029] text-white"
                    : "border border-[#333029]/10 bg-[#F8F7F4] text-brand-taupe hover:border-brand-gold hover:text-brand-dark"
                }`}
              >
                {filterValue === "all"
                  ? "Todos"
                  : filterValue === "admin"
                    ? "Admin"
                    : filterValue === "colaborador"
                      ? "Colaborador"
                      : "Consumidor"}
              </button>
            )
          )}
        </div>
      </div>

      {errorList && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
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

      <div className="overflow-hidden rounded-2xl border border-[#333029]/10 bg-white">
        {loadingList ? (
          <div className="px-5 py-14 text-center text-sm text-brand-taupe">
            <div className="inline-flex items-center gap-2">
              <Loader2
                className="h-5 w-5 animate-spin text-brand-gold"
                aria-hidden="true"
              />
              Carregando usuários cadastrados...
            </div>
          </div>
        ) : filteredPerfis.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-brand-taupe">
            <Users
              className="mx-auto mb-2 h-6 w-6 text-brand-olive"
              aria-hidden="true"
            />
            Nenhum usuário encontrado com os filtros atuais.
          </div>
        ) : (
          <>
            {/* Lista em cards para celular (< md) */}
            <ul className="divide-y divide-[#333029]/10 md:hidden">
              {filteredPerfis.map((perfil) => {
                const isSelf = perfil.id === currentUser?.id;
                const isBusy = updatingId === perfil.id;

                return (
                  <li key={perfil.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <UserCheck
                            className="h-4 w-4 shrink-0 text-brand-olive"
                            aria-hidden="true"
                          />
                          <p className="truncate text-sm font-semibold text-brand-dark">
                            {perfil.email}
                          </p>
                          {isSelf && (
                            <span className="shrink-0 rounded-md bg-brand-yellow/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-dark">
                              Você
                            </span>
                          )}
                        </div>
                        <p className={`mt-1 text-[11px] text-brand-taupe ${NUM}`}>
                          Criado em {formatDate(perfil.created_at)}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${getRoleBadgeClasses(
                          perfil.role
                        )}`}
                      >
                        {perfil.role}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        role="group"
                        aria-label={`Alternar role de ${perfil.email}`}
                        className="grid flex-1 grid-cols-3 gap-1 rounded-xl border border-[#333029]/10 bg-[#F3F1EC] p-1"
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
                              className={`cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                active
                                  ? "bg-brand-yellow text-brand-dark"
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
                          className="h-4 w-4 shrink-0 animate-spin text-brand-gold"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Tabela completa no desktop (>= md) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr
                    className={`border-b border-[#333029]/10 bg-[#F3F1EC] ${MICRO_LABEL}`}
                  >
                    <th className="px-5 py-3.5">Usuário (E-mail)</th>
                    <th className="px-5 py-3.5">Role Atual</th>
                    <th className="px-5 py-3.5">Data de Criação</th>
                    <th className="px-5 py-3.5 text-right">Alterar Permissão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#333029]/10">
                  {filteredPerfis.map((perfil) => {
                    const isSelf = perfil.id === currentUser?.id;
                    const isBusy = updatingId === perfil.id;

                    return (
                      <tr
                        key={perfil.id}
                        className="transition-colors hover:bg-[#F8F7F4]"
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

                        <td className={`px-5 py-4 text-xs text-brand-taupe ${NUM}`}>
                          {formatDate(perfil.created_at)}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <div
                              role="group"
                              aria-label={`Alternar role de ${perfil.email}`}
                              className="inline-flex rounded-xl border border-[#333029]/10 bg-[#F3F1EC] p-0.5"
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
                                    className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                      active
                                        ? "bg-brand-yellow text-brand-dark"
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
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
