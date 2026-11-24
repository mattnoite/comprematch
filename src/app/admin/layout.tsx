import type { ReactNode } from "react";
import { AdminShell } from "@/components/AdminShell";

// Área autenticada com guarda client-side: isenta a validação instant-navigation do Next.js 16
export const instant = false;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
