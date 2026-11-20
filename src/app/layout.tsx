import type { Metadata } from "next";
import { AuthProvider } from "@/contexts/AuthContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompreMatch — Conectando compradores e lojas locais",
  description:
    "Plataforma inteligente de descoberta e correspondência local com mapa interativo, Supabase e Gemini.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#fcfaf5] text-brand-dark">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
