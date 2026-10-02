"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Renders overlays at <body>, out of any ancestor that would trap position:fixed
 *  (transforms, running animations, backdrop-filter). */
export function Portal({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}
