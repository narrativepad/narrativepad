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
  { ssr: false, loading: () => <div className="h-[2.375rem] w-36 rounded-full bg-white/[0.05]" /> },
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
    <label className="relative hidden w-full max-w-[15rem] xl:block 2xl:max-w-[19rem]">
      <span className="sr-only">Search narratives</span>
      <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
      <input
        ref={ref}
        className="h-[2.375rem] w-full rounded-full border border-white/[0.08] bg-white/[0.04] pl-10 pr-14 text-sm text-ink outline-none transition-colors placeholder:text-dim focus:border-white/20 focus:bg-white/[0.06]"
        placeholder="Search coins"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[0.62rem] text-dim">
        Ctrl K
      </kbd>
    </label>
  );
}

function Identity() {
  const { address, name, kind } = useIdentity();
  if (!address) return <div className="h-[2.375rem] w-[2.375rem] rounded-full bg-white/[0.05] sm:w-36" />;
  return (
    <Link
      href={`/profile/${address}`}
      className="flex h-[2.375rem] shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] p-1 transition-colors hover:bg-white/[0.09] sm:pr-3.5"
      title={kind === "guest" ? "A free guest identity kept in this browser, so you can vote without a wallet. It never holds funds." : "Your connected wallet"}
    >
      <Avatar address={address} size={28} />
      <span className="hidden min-w-0 flex-col leading-none sm:flex">
        <span className="max-w-[9rem] truncate text-[0.8rem] font-medium">{name}</span>
        <span className="mt-0.5 text-[0.65rem] text-dim">{kind === "guest" ? "guest" : "wallet"}</span>
      </span>
    </Link>
  );
}

export function Header() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-white/[0.06] bg-bg/70 backdrop-blur-2xl backdrop-saturate-150">
      <div className="flex h-16 w-full items-center gap-3 px-4 sm:px-5 lg:gap-10 lg:px-8 2xl:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="narrativepad home">
          <Logo size={30} />
          <span className="text-[1.1rem] font-semibold tracking-[-0.02em]">narrativepad</span>
        </Link>
        <nav className="hidden items-center gap-7 text-[0.88rem] lg:flex">
          {NAV.filter((n) => n.href !== "/create").map((n) => (
            <Link key={n.href} href={n.href} className={`font-medium transition-colors ${isActive(n.href) ? "text-ink" : "text-muted hover:text-ink"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <Suspense>
            <Search />
          </Suspense>
          <Link href="/create" className="btn-primary hidden h-[2.375rem] py-0 sm:inline-flex">
            <Icon name="plus" className="h-4 w-4" />
            Start a narrative
          </Link>
          <Identity />
          <div className="hidden lg:block">
            <WalletButton />
          </div>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-white/[0.05] px-3 py-2 text-[0.84rem] sm:px-4 lg:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`shrink-0 rounded-full px-3.5 py-1.5 font-medium transition-colors ${isActive(n.href) ? "bg-white text-black" : "text-muted"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
