"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/lib/client/useSigned";
import { Avatar, Icon, Logo } from "./bits";
import { CommandPalette, openPalette } from "./CommandPalette";

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
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how-it-works", label: "How it works" },
];

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
      <CommandPalette />
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
          <button
            type="button"
            onClick={openPalette}
            className="hidden h-[2.375rem] w-[15rem] items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.04] pl-3.5 pr-2.5 text-sm text-dim transition-colors hover:border-white/15 hover:text-muted xl:flex 2xl:w-[19rem]"
          >
            <Icon name="search" className="h-4 w-4" />
            Search coins
            <kbd className="ml-auto rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[0.62rem]">Ctrl K</kbd>
          </button>
          <button
            type="button"
            onClick={openPalette}
            aria-label="Search coins"
            className="flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-muted hover:text-ink xl:hidden"
          >
            <Icon name="search" className="h-4 w-4" />
          </button>
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
