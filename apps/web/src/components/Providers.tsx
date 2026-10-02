"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { PublicConfig } from "@/lib/config";

const ConfigContext = createContext<PublicConfig | null>(null);
export const usePublicConfig = () => useContext(ConfigContext)!;

type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function Providers({ config, children }: { config: PublicConfig; children: ReactNode }) {
  // Wallets supporting the Wallet Standard (Phantom, Solflare, Backpack…) are auto-detected.
  const wallets = useMemo(() => [], []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ConfigContext.Provider value={config}>
      <ConnectionProvider endpoint="https://api.devnet.solana.com">
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <ToastContext.Provider value={push}>
              {children}
              <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
                {toasts.map((t) => (
                  <div
                    key={t.id}
                    role="status"
                    className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-line-2 bg-panel-2/90 py-2.5 pl-3 pr-4 text-sm text-ink shadow-[0_20px_50px_-12px_rgb(0_0_0/0.9)] backdrop-blur-xl"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        t.kind === "ok" ? "bg-accent/15 text-accent" : t.kind === "err" ? "bg-danger/15 text-danger" : "bg-white/10 text-ink"
                      }`}
                    >
                      {t.kind === "ok" ? "✓" : t.kind === "err" ? "!" : "i"}
                    </span>
                    {t.text}
                  </div>
                ))}
              </div>
            </ToastContext.Provider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ConfigContext.Provider>
  );
}
