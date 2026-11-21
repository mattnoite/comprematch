"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface RouteMapOrigin {
  lat: number;
  lng: number;
  label: string;
}

export interface RouteMapStop {
  mercado_id: string;
  nome_rede: string;
  unidade: string;
  lat: number;
  lng: number;
  subtotal: number;
  itemCount: number;
  letter: string;
}

interface RouteMapProps {
  origin: RouteMapOrigin | null;
  stops: RouteMapStop[];
  routeCoordinates: Array<[number, number]>;
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function createOriginIcon(): L.DivIcon {
  return L.divIcon({
    className: "comprematch-map-marker",
    html: `
      <div style="display:flex;align-items:center;gap:4px;background:#333029;color:#FFB400;border:2px solid #FFB400;border-radius:9999px;padding:4px 10px 4px 8px;font-weight:800;font-size:12px;box-shadow:0 4px 12px rgba(51,48,41,0.35);white-space:nowrap;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
          <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        <span>A</span>
      </div>
    `,
    iconSize: [52, 30],
    iconAnchor: [26, 15],
    popupAnchor: [0, -16],
  });
}

function createStoreIcon(letter: string): L.DivIcon {
  const safeLetter = letter.replace(/[^A-Z0-9]/gi, "").slice(0, 2) || "B";
  return L.divIcon({
    className: "comprematch-map-marker",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:#FFB400;color:#333029;border:2.5px solid #333029;outline:2px solid #CC9B29;font-weight:900;font-size:13px;box-shadow:0 4px 12px rgba(51,48,41,0.35);">
        ${safeLetter}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

function buildOriginPopupNode(origin: RouteMapOrigin): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.minWidth = "170px";
  wrapper.style.color = "#333029";

  const badge = document.createElement("span");
  badge.textContent = "Ponto A · Origem";
  badge.style.display = "inline-block";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "700";
  badge.style.color = "#997D3D";
  badge.style.marginBottom = "4px";

  const title = document.createElement("p");
  title.textContent = origin.label;
  title.style.margin = "0";
  title.style.fontSize = "12px";
  title.style.fontWeight = "700";

  wrapper.append(badge, title);
  return wrapper;
}

function buildStopPopupNode(stop: RouteMapStop, orderIndex: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.minWidth = "190px";
  wrapper.style.color = "#333029";

  const badge = document.createElement("span");
  badge.textContent = `Ponto ${stop.letter} · ${orderIndex + 1}ª parada`;
  badge.style.display = "inline-block";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "700";
  badge.style.color = "#997D3D";
  badge.style.marginBottom = "4px";

  const title = document.createElement("p");
  title.textContent = stop.nome_rede;
  title.style.margin = "0";
  title.style.fontSize = "13px";
  title.style.fontWeight = "800";

  const unit = document.createElement("p");
  unit.textContent = stop.unidade;
  unit.style.margin = "2px 0 8px";
  unit.style.fontSize = "11px";
  unit.style.color = "#665A3D";

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.justifyContent = "space-between";
  footer.style.alignItems = "center";
  footer.style.borderTop = "1px solid rgba(102,90,61,0.2)";
  footer.style.paddingTop = "6px";
  footer.style.fontSize = "12px";

  const itemsText = document.createElement("span");
  itemsText.textContent = `${stop.itemCount} ${stop.itemCount === 1 ? "item" : "itens"}`;
  itemsText.style.color = "#665A3D";

  const subtotalText = document.createElement("strong");
  subtotalText.textContent = formatBRL(stop.subtotal);
  subtotalText.style.color = "#333029";

  footer.append(itemsText, subtotalText);
  wrapper.append(badge, title, unit, footer);
  return wrapper;
}

export default function RouteMap({
  origin,
  stops,
  routeCoordinates,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const defaultCenter: [number, number] = origin
      ? [origin.lat, origin.lng]
      : stops[0]
        ? [stops[0].lat, stops[0].lng]
        : [-23.5505, -46.6333];

    const map = L.map(container, {
      center: defaultCenter,
      zoom: 13,
      scrollWheelZoom: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // Inicializa o mapa uma única vez; atualizações de camadas ocorrem no efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);

    if (routeCoordinates.length > 1) {
      L.polyline(routeCoordinates, {
        color: "#333029",
        weight: 8,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);

      L.polyline(routeCoordinates, {
        color: "#FFB400",
        weight: 4.5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);

      for (const coord of routeCoordinates) {
        bounds.extend(coord);
      }
    }

    if (origin) {
      const originMarker = L.marker([origin.lat, origin.lng], {
        icon: createOriginIcon(),
        zIndexOffset: 1000,
      }).bindPopup(buildOriginPopupNode(origin));
      originMarker.addTo(group);
      bounds.extend([origin.lat, origin.lng]);
    }

    stops.forEach((stop, idx) => {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: createStoreIcon(stop.letter),
        zIndexOffset: 500 - idx,
      }).bindPopup(buildStopPopupNode(stop, idx));
      marker.addTo(group);
      bounds.extend([stop.lat, stop.lng]);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    }
  }, [origin, stops, routeCoordinates]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Mapa interativo da rota de compras"
      className="h-[400px] w-full rounded-2xl border border-brand-taupe bg-[#faf7ef] sm:h-[480px] lg:h-[560px]"
    />
  );
}
