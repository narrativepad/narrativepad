import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel mx-auto mt-10 max-w-md p-8 text-center">
      <p className="text-lg font-semibold">Not found</p>
      <p className="mt-1 text-sm text-muted">This narrative doesn&apos;t exist or was hidden after reports.</p>
      <Link href="/" className="btn mt-4">
        Back to the feed
      </Link>
    </div>
  );
}
