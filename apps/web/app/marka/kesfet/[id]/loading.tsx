export default function CreatorProfileLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="h-7 w-32 rounded-full bg-surface-muted" />
      <section className="rounded-3xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start gap-5">
          <div className="h-22 w-22 rounded-full bg-surface-muted" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-7 w-56 rounded-lg bg-surface-muted" />
            <div className="h-4 w-40 rounded-lg bg-surface-muted" />
          </div>
          <div className="h-9 w-32 rounded-full bg-surface-muted" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl border border-border bg-bg/40" />
          ))}
        </div>
      </section>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-28 rounded-full bg-surface-muted" />
        ))}
      </div>
      <div className="h-72 rounded-3xl border border-border bg-surface" />
    </div>
  );
}

