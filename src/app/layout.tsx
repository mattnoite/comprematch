import type { Metadata } from "next";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompreMatch — Ofertas locais e compras inteligentes",
  description:
    "Plataforma inteligente de descoberta de ofertas locais de supermercados, carrinho agrupado por mercado e roteirização.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#fcfaf5] text-brand-dark">
        <AuthProvider>
          <CartProvider>{children}</CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
