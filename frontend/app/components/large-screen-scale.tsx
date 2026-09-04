"use client";

import { useEffect } from "react";

const BASE_WIDTH = 1680;
const BASE_HEIGHT = 920;
const MAX_SCALE = 1.6;
const VIEWPORT_GUTTER = 24;

export function LargeScreenScale() {
  useEffect(() => {
    const updateScale = () => {
      const availableWidth = document.documentElement.clientWidth || window.innerWidth;
      const availableHeight = document.documentElement.clientHeight || window.innerHeight;
      const widthScale = (availableWidth - VIEWPORT_GUTTER) / BASE_WIDTH;
      const heightScale = (availableHeight - VIEWPORT_GUTTER) / BASE_HEIGHT;
      const scale = Math.min(MAX_SCALE, Math.max(1, Math.min(widthScale, heightScale)));
      document.documentElement.style.setProperty("--large-screen-scale", String(scale));
    };

    updateScale();
    window.addEventListener("resize", updateScale, { passive: true });
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return null;
}
