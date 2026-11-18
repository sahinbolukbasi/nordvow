export default function BrandCampaignLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-64 rounded-lg bg-surface-muted" />
          <div className="h-4 w-48 rounded-lg bg-surface-muted" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded-full bg-surface-muted" />
          <div className="h-9 w-32 rounded-full bg-surface-muted" />
        </div>
      </div>
      <div className="h-14 rounded-2xl border border-border bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-surface-muted" />
        ))}
      </div>
      <div className="h-64 rounded-3xl border border-border bg-surface" />
    </div>
  );
}

