import type { Metadata } from "next";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompreMatch — Economize no supermercado comparando encartes",
  description:
    "Compare ofertas dos supermercados da sua região, monte sua cesta inteligente multiloja e trace o trajeto mais econômico.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#FAFAF9] text-brand-dark">
        <AuthProvider>
          <CartProvider>{children}</CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
