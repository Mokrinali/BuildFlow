"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

export function MobileMenu({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the panel whenever the route changes (adjusting state during render, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        {brand}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu-panel"
          onClick={() => setOpen((v) => !v)}
          className="min-h-10 rounded border border-white/40 px-3 text-sm font-medium"
        >
          {open ? "დახურვა" : "მენიუ"}
        </button>
      </div>
      <div id="mobile-menu-panel" hidden={!open}>
        {children}
      </div>
    </>
  );
}
