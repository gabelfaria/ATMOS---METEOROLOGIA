import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { reverse } from '../api/client';
import type { Place } from '../api/types';
import { load, save } from './storage';

interface LocationCtx {
  place: Place | null;
  locating: boolean;
  geoError: string | null;
  requestGps: () => void;
  setPlace: (p: Place) => void;
  forget: () => void;
}

const Ctx = createContext<LocationCtx | null>(null);
const KEY = 'atmos:place';

export function LocationProvider({ children }: { children: ReactNode }) {
  const [place, setPlaceState] = useState<Place | null>(() => load<Place | null>(KEY, null));
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const setPlace = useCallback((p: Place) => {
    // Guardamos só no aparelho, arredondado (~100 m).
    const stored = { ...p, lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 };
    setPlaceState(stored);
    save(KEY, stored);
  }, []);

  const requestGps = useCallback(() => {
    if (Capacitor.isNativePlatform()) {
      setLocating(true);
      setGeoError(null);
      (async () => {
        try {
          const perm = await Geolocation.requestPermissions({ permissions: ['coarseLocation', 'location'] });
          if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') throw Object.assign(new Error('denied'), { denied: true });
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 });
          const { latitude, longitude, accuracy } = pos.coords;
          let label = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
          try {
            const r = await reverse(latitude, longitude);
            if (r.label) label = r.label;
          } catch {
            /* rótulo por coordenadas */
          }
          setPlace({ lat: latitude, lon: longitude, label, source: 'gps', accuracy });
        } catch (e) {
          setGeoError(
            (e as { denied?: boolean }).denied
              ? 'Permissão de localização negada. Você pode buscar o local manualmente.'
              : 'Não foi possível obter a localização. Verifique se o GPS está ligado ou busque o local.',
          );
        } finally {
          setLocating(false);
        }
      })();
      return;
    }
    if (!('geolocation' in navigator)) {
      setGeoError('Este navegador não oferece geolocalização. Busque o local manualmente.');
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        let label = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
        try {
          const r = await reverse(latitude, longitude);
          if (r.label) label = r.label;
        } catch {
          /* rótulo por coordenadas */
        }
        setPlace({ lat: latitude, lon: longitude, label, source: 'gps', accuracy });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada. Você pode buscar o local manualmente.'
            : err.code === err.TIMEOUT
              ? 'O GPS demorou demais para responder. Tente novamente ou busque o local.'
              : 'Não foi possível obter a localização.',
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  }, [setPlace]);

  const forget = useCallback(() => {
    setPlaceState(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ place, locating, geoError, requestGps, setPlace, forget }),
    [place, locating, geoError, requestGps, setPlace, forget],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation() {
  const c = useContext(Ctx);
  if (!c) throw new Error('LocationProvider ausente');
  return c;
}
