import { useState, useEffect } from "react";
import type { HwMetrics } from "../types";

export function useHardwareMetrics() {
  const [hardwareMetrics, setHardwareMetrics] = useState<HwMetrics | null>(null);
  const [hardwareHistory, setHardwareHistory] = useState<HwMetrics[]>([]);

  useEffect(() => {
    const hwApi = (window as unknown as Record<string, Record<string, (...args: unknown[]) => void>>).electronAPI;
    hwApi?.onHardwareMetrics?.((data: unknown) => {
      const d = data as HwMetrics;
      setHardwareMetrics(d);
      setHardwareHistory(prev => {
        const next = [...prev, d];
        return next.length > 120 ? next.slice(-120) : next;
      });
    });
    return () => { hwApi?.removeHardwareMetrics?.(); };
  }, []);

  return { hardwareMetrics, hardwareHistory };
}
