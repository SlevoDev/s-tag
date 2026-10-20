"use client";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Popup, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useRef } from "react";

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

export type Item = {
  id: string;
  name: string;
  status: "secured" | "missing" | "inactive";
  lat: number;
  lng: number;
  lastSeen: string;
};

interface MapViewProps {
  items: Item[];
  selectedId: string | null;
  onSelect?: (id: string) => void;
  /** Valgfri posisjon å fly kartet til — f.eks. brukerens egen posisjon. [lat, lng, nonce] så samme posisjon kan fly igjen. */
  flyTo?: { lat: number; lng: number; zoom?: number; nonce?: number } | null;
  /** Brukerens egen posisjon — vises som en egen blå markør */
  userPosition?: { lat: number; lng: number } | null;
}

const statusColor = (status: Item["status"]) =>
  status === "missing" ? "#dc2626" : status === "inactive" ? "#94a3b8" : "#0f2a5c";

// Internal component that flies the map to selected item or a custom target
function MapController({
  items,
  selectedId,
  flyTo,
}: {
  items: Item[];
  selectedId: string | null;
  flyTo?: MapViewProps["flyTo"];
}) {
  const map = useMap();
  const markerRefs = useRef<Map<string, L.CircleMarker>>(new Map());

  useEffect(() => {
    if (!selectedId) return;
    const item = items.find((i) => i.id === selectedId);
    if (!item) return;
    map.flyTo([item.lat, item.lng], 16, {
      duration: 1.4,
      easeLinearity: 0.25,
    });
    const t = setTimeout(() => {
      const m = markerRefs.current.get(selectedId);
      if (m) m.openPopup();
    }, 1450);
    return () => clearTimeout(t);
  }, [selectedId, items, map]);

  // Ekstern flyTo (brukerens posisjon osv.) — nonce lar samme koordinat trigge på nytt
  useEffect(() => {
    if (!flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 16, {
      duration: 1.4,
      easeLinearity: 0.25,
    });
  }, [flyTo?.lat, flyTo?.lng, flyTo?.nonce, flyTo?.zoom, map]);

  return (
    <>
      {items.map((item) => {
        const isSelected = item.id === selectedId;
        return (
          <CircleMarker
            key={item.id}
            center={[item.lat, item.lng]}
            radius={isSelected ? 16 : 11}
            pathOptions={{
              color: "#ffffff",
              fillColor: statusColor(item.status),
              fillOpacity: 1,
              weight: isSelected ? 4 : 3,
            }}
            ref={(ref) => {
              if (ref) markerRefs.current.set(item.id, ref);
            }}
          >
            <Popup>
              <div className="p-1 min-w-[180px]">
                <div className="font-bold text-slate-900 text-sm">{item.name}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">
                  {item.status === "secured"
                    ? "● Sikret"
                    : item.status === "missing"
                    ? "● Savnet"
                    : "● Inaktiv"}
                </div>
                <div className="text-xs text-slate-600 mt-1">{item.lastSeen}</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export default function MapView({ items, selectedId, flyTo, userPosition }: MapViewProps) {
  useEffect(() => {
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  }, []);

  return (
    <MapContainer
      center={[59.9139, 10.7522]}
      zoom={13}
      scrollWheelZoom
      className="w-full h-full"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.kartverket.no/">Kartverket</a>'
        url="https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png"
        maxZoom={18}
      />
      <MapController items={items} selectedId={selectedId} flyTo={flyTo} />
      {userPosition && (
        <CircleMarker
          center={[userPosition.lat, userPosition.lng]}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            fillColor: "#2563eb",
            fillOpacity: 1,
            weight: 3,
          }}
        >
          <Popup>
            <div className="p-1 text-xs font-bold text-slate-900">Du er her</div>
          </Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
