import { useEffect, useRef, useState } from 'react';

/** Puxar para baixo no topo da página dispara `onRefresh` (gesto padrão de apps Android). */
export function usePullToRefresh(onRefresh: () => Promise<unknown> | void, enabled: boolean) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      pullRef.current = Math.min(dy * 0.5, 110);
      setPull(pullRef.current);
    };
    const up = async () => {
      const go = pullRef.current >= 70;
      start.current = null;
      pullRef.current = 0;
      setPull(0);
      if (go) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [enabled, onRefresh]);

  return { pull, refreshing };
}
