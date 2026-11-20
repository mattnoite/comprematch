"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type ToastType = "success" | "error";

export interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  if (!toast) return null;

  const isSuccess = toast.type === "success";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-5 bottom-5 z-50 w-full max-w-sm"
    >
      <div
        className={`flex items-start gap-3 rounded-xl border p-4 shadow-lg ${
          isSuccess
            ? "border-brand-yellow bg-brand-dark text-white"
            : "border-red-500/40 bg-red-950 text-white"
        }`}
      >
        {isSuccess ? (
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-brand-yellow"
            aria-hidden="true"
          />
        ) : (
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-red-400"
            aria-hidden="true"
          />
        )}

        <div className="flex-1 text-sm">
          <p className="font-semibold">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-xs text-white/80">{toast.description}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar notificação"
          className="cursor-pointer rounded-md p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
