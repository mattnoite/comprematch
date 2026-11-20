import Link from "next/link";
import {
  ArrowRight,
  Compass,
  LogIn,
  MapPin,
  Search,
  Sparkles,
  Store,
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fcfaf5] text-brand-dark">
      <header className="border-b border-brand-taupe/15 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-yellow text-brand-dark shadow-xs">
              <Store className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold tracking-tight text-brand-dark">
              CompreMatch
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-brand-olive/15 px-3 py-1 text-xs font-semibold text-brand-taupe sm:inline-flex">
              <Sparkles className="h-3.5 w-3.5 text-brand-gold" aria-hidden="true" />
              IA + Geolocalização
            </span>
            <Link
              id="header-login-link"
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-taupe/40 bg-white px-3.5 py-2 text-sm font-semibold text-brand-dark transition-colors hover:bg-brand-yellow/15"
            >
              <LogIn className="h-4 w-4 text-brand-olive" aria-hidden="true" />
              Entrar
            </Link>
            <a
              id="header-explore-btn"
              href="#recursos"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-dark px-4 py-2 text-sm font-semibold text-brand-yellow transition-colors hover:bg-brand-taupe"
            >
              Explorar
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <section className="max-w-2xl space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-yellow/25 px-2.5 py-1 text-xs font-semibold text-brand-dark">
              <MapPin className="h-3.5 w-3.5 text-brand-taupe" aria-hidden="true" />
              Leaflet Pronto
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-gold/20 px-2.5 py-1 text-xs font-semibold text-brand-taupe">
              Supabase &amp; Gemini Configurados
            </span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-brand-dark sm:text-5xl">
            Encontre exatamente o que você procura perto de você.
          </h1>

          <p className="text-lg leading-relaxed text-brand-taupe">
            O CompreMatch combina busca inteligente com Gemini, persistência em
            tempo real com Supabase e visualização geográfica em mapa com
            Leaflet para aproximar quem quer comprar de quem tem a oferta ideal.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              id="primary-search-btn"
              type="button"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-yellow px-5 py-3 text-sm font-bold text-brand-dark shadow-xs transition-colors hover:bg-brand-gold"
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              Iniciar Busca Inteligente
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              id="secondary-map-btn"
              type="button"
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-brand-taupe/30 bg-white px-5 py-3 text-sm font-semibold text-brand-dark transition-colors hover:border-brand-olive hover:bg-brand-yellow/10"
            >
              <Compass className="h-4 w-4 text-brand-olive" aria-hidden="true" />
              Abrir Mapa Local
            </button>
          </div>
        </section>

        <section
          id="recursos"
          className="mt-16 grid gap-5 border-t border-brand-taupe/15 pt-10 sm:grid-cols-3"
        >
          <article className="rounded-xl border border-brand-taupe/15 bg-white p-5">
            <span className="inline-block rounded-md bg-brand-yellow/20 px-2.5 py-1 text-xs font-semibold text-brand-dark">
              Design System
            </span>
            <h2 className="mt-3 text-base font-semibold text-brand-dark">
              Paleta CompreMatch
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-taupe">
              Tokens personalizados configurados em{" "}
              <code className="font-mono text-xs text-brand-olive">
                theme.extend.colors.brand
              </code>{" "}
              para ações e badges consistentes.
            </p>
          </article>

          <article className="rounded-xl border border-brand-taupe/15 bg-white p-5">
            <span className="inline-block rounded-md bg-brand-olive/15 px-2.5 py-1 text-xs font-semibold text-brand-taupe">
              Mapas
            </span>
            <h2 className="mt-3 text-base font-semibold text-brand-dark">
              Leaflet Integrado
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-taupe">
              Estilos do Leaflet importados globalmente e tipagens TypeScript
              prontas para componentes de mapa no cliente.
            </p>
          </article>

          <article className="rounded-xl border border-brand-taupe/15 bg-white p-5">
            <span className="inline-block rounded-md bg-brand-dark px-2.5 py-1 text-xs font-semibold text-brand-yellow">
              Backend &amp; IA
            </span>
            <h2 className="mt-3 text-base font-semibold text-brand-dark">
              Supabase &amp; Gemini
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-brand-taupe">
              Variáveis de ambiente mapeadas em{" "}
              <code className="font-mono text-xs text-brand-olive">
                .env.local.example
              </code>{" "}
              para conexão rápida.
            </p>
          </article>
        </section>
      </main>

      <footer className="border-t border-brand-taupe/15 bg-white/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 text-xs text-brand-taupe">
          <span>CompreMatch &copy; 2026</span>
          <span className="font-medium text-brand-olive">
            Next.js + Tailwind CSS + TypeScript
          </span>
        </div>
      </footer>
    </div>
  );
}
