// Skeleton for the leaderboard.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-12 w-72" />
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-[28rem] rounded-[1.25rem]" />
        ))}
      </div>
    </div>
  );
}
