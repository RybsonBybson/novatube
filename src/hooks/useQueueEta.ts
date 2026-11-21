import { useEffect, useMemo, useRef, useState } from "react";
import type { DownloadItem } from "@shared/types";
import { estimateQueueEta, type QueueEta } from "../lib/eta";

/** Slow enough to smooth jitter, fast enough to react within a second or two. */
const SMOOTHING = 0.3;
/** Startup bursts can be 10× the sustained rate; never let them dominate. */
const MAX_SURGE = 2.5;
/** Brief dips (buffer stalls) should not inflate the estimate wildly. */
const MIN_DIP = 0.4;

/**
 * Watches the live queue and produces a smoothed throughput plus a realistic
 * whole-queue ETA. Two non-zero samples are required before a number is shown,
 * which filters out the first, often wildly optimistic speed reading.
 */
export function useQueueEta(items: DownloadItem[], concurrency: number): QueueEta {
  const measured = useMemo(
    () =>
      items
        .filter((item) => item.status === "fetching" || item.status === "downloading")
        .reduce((sum, item) => sum + (item.speedBytes ?? 0), 0),
    [items],
  );
  const transferring = useMemo(
    () => items.some((item) => item.status === "fetching" || item.status === "downloading"),
    [items],
  );

  const state = useRef<{ value: number | null; samples: number }>({ value: null, samples: 0 });
  const [throughput, setThroughput] = useState<number | null>(null);

  useEffect(() => {
    if (!transferring) return; // keep the last rate across pauses/resumes
    if (measured <= 0) return;

    const current = state.current;
    if (current.samples === 0) {
      current.value = measured;
      current.samples = 1;
      return; // wait for a second sample before publishing
    }

    const previous = current.value ?? measured;
    const bounded = Math.min(measured, previous * MAX_SURGE);
    const floored = Math.max(bounded, previous * MIN_DIP);
    const next = previous * (1 - SMOOTHING) + floored * SMOOTHING;
    current.value = next;
    current.samples += 1;
    setThroughput(next);
  }, [measured, transferring]);

  /* Clear the sample window when nothing is left, so a fresh queue starts clean. */
  useEffect(() => {
    if (items.length === 0) {
      state.current = { value: null, samples: 0 };
      setThroughput(null);
    }
  }, [items.length]);

  return useMemo(() => estimateQueueEta(items, { throughput, concurrency }), [items, throughput, concurrency]);
}
