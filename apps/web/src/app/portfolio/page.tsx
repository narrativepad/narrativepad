import type { Metadata } from "next";
import { PortfolioView } from "./PortfolioView";

export const metadata: Metadata = { title: "Your portfolio" };

export default function PortfolioPage() {
  return <PortfolioView />;
}
