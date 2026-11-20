import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Renders a growing slice of a potentially huge list and loads the next slice
 * when the sentinel scrolls into view. This keeps the DOM small (no thousands
 * of mounted rows) while still feeling like a normal, infinite list.
 */
export function useIncremental<T>(items: T[], pageSize = 60, resetKey?: unknown) {
  const [count, setCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);

  const visible = useMemo(() => items.slice(0, Math.min(count, items.length)), [items, count]);
  const hasMore = count < items.length;
  const showAll = useCallback(() => setCount(items.length), [items.length]);
  const shown = visible.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setCount((current) => Math.min(items.length, current + pageSize));
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, items.length, pageSize]);

  return { visible, hasMore, sentinelRef, showAll, shown, total: items.length };
}