// Skeleton while a page's data loads.
export default function Loading() {
  return (
    <div className="flex flex-col gap-8 pt-10" aria-busy="true" aria-label="Loading">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="skeleton h-7 w-64 rounded-full" />
          <div className="skeleton h-16 w-full max-w-xl" />
          <div className="skeleton h-16 w-4/5 max-w-lg" />
          <div className="skeleton mt-2 h-20 w-full max-w-md" />
        </div>
        <div className="skeleton mx-auto aspect-square w-full max-w-[28rem] rounded-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton h-72 rounded-[1.25rem]" />
        ))}
      </div>
    </div>
  );
}
