"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/client/useSigned";
import { Avatar, Icon, Logo } from "./bits";

const WalletButton = dynamic(
  async () => {
    const { BaseWalletMultiButton } = await import("@solana/wallet-adapter-react-ui");
    const labels = {
      "change-wallet": "Change wallet",
      connecting: "Connecting…",
      "copy-address": "Copy address",
      copied: "Copied",
      disconnect: "Disconnect",
      "has-wallet": "Connect wallet",
      "no-wallet": "Connect wallet",
    };
    return function WalletButton() {
      return <BaseWalletMultiButton labels={labels} />;
    };
  },
  { ssr: false, loading: () => <div className="h-9 w-36 rounded-xl bg-panel-2" /> },
);

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how-it-works", label: "How it works" },
];

function Search() {
  const router = useRouter();
  const params = useSearchParams();
  const path = usePathname();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => setQ(params.get("q") ?? ""), [params]);
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current || (path !== "/" && !q)) return;
    const t = setTimeout(() => router.replace(q ? `/?q=${encodeURIComponent(q)}` : "/", { scroll: false }), 250);
    return () => clearTimeout(t);
  }, [q, params, path, router]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <label className="relative hidden w-full max-w-[16rem] xl:block 2xl:max-w-[20rem]">
      <span className="sr-only">Search narratives</span>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
      <input ref={ref} className="input h-9 py-0 pl-9 pr-14" placeholder="Search coins" value={q} onChange={(e) => setQ(e.target.value)} />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-[0.62rem] text-dim">
        Ctrl K
      </kbd>
    </label>
  );
}

function Identity() {
  const { address, name, kind } = useIdentity();
  if (!address) return <div className="h-9 w-9 rounded-xl bg-panel-2 sm:w-36" />;
  return (
    <Link
      href={`/profile/${address}`}
      className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-line-2 bg-panel-2 pl-1.5 pr-1.5 text-sm transition-colors hover:border-dim/60 sm:pr-3"
      title={kind === "guest" ? "A free guest identity kept in this browser, so you can vote without a wallet. It never holds funds." : "Your connected wallet"}
    >
      <Avatar address={address} size={24} />
      <span className="hidden min-w-0 flex-col leading-none sm:flex">
        <span className="max-w-[9rem] truncate text-[0.82rem] font-medium">{name}</span>
        <span className="mt-0.5 text-[0.65rem] text-dim">{kind === "guest" ? "guest" : "wallet"}</span>
      </span>
    </Link>
  );
}

export function Header() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="flex h-15 w-full items-center gap-3 px-3 sm:px-4 lg:gap-8 lg:px-6 2xl:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="narrativepad home">
          <Logo size={30} />
          <span className="text-[1.08rem] font-semibold tracking-tight">narrativepad</span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm lg:flex">
          {NAV.filter((n) => n.href !== "/create").map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${isActive(n.href) ? "bg-white/[0.06] text-ink" : "text-muted hover:text-ink"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Suspense>
            <Search />
          </Suspense>
          <Link href="/create" className="btn-primary hidden h-9 py-0 sm:inline-flex">
            <Icon name="plus" className="h-4 w-4" />
            Start a narrative
          </Link>
          <Identity />
          <div className="hidden lg:block">
            <WalletButton />
          </div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 text-[0.82rem] sm:px-4 lg:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`shrink-0 rounded-lg px-3 py-1.5 font-medium transition-colors ${isActive(n.href) ? "bg-white/[0.07] text-ink" : "text-muted"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
