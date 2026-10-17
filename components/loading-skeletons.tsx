function Block({ className = "" }: { className?: string }) {
  return <span className={`qb-skeleton ${className}`} />;
}

export function RestaurantCardsSkeleton() {
  return <div className="qb-restaurant-grid qb-skeleton-grid" role="status" aria-label="Loading restaurants">
    <span className="qb-sr-only">Loading restaurants</span>
    {[0, 1, 2].map((index) => <div className="qb-restaurant-card qb-skeleton-card" key={index} aria-hidden="true">
      <Block className="qb-skeleton-photo" />
      <div className="qb-skeleton-card-body">
        <Block className="qb-skeleton-title" />
        <Block className="qb-skeleton-line medium" />
        <Block className="qb-skeleton-line short" />
        <Block className="qb-skeleton-pill" />
      </div>
    </div>)}
  </div>;
}

export function ManagementWorkspaceSkeleton() {
  return <div className="qb-management qb-workspace-skeleton" role="status" aria-label="Loading restaurant workspace">
    <span className="qb-sr-only">Loading restaurant workspace</span>
    <aside className="qb-sidebar" aria-hidden="true">
      <Block className="qb-skeleton-logo" />
      <Block className="qb-skeleton-line medium" />
      <Block className="qb-skeleton-select" />
      <div className="qb-skeleton-nav">{[0, 1, 2, 3, 4, 5].map((item) => <Block className="qb-skeleton-nav-item" key={item} />)}</div>
    </aside>
    <main className="qb-manage-main" aria-hidden="true">
      <Block className="qb-skeleton-line short" />
      <Block className="qb-skeleton-heading" />
      <div className="qb-panel qb-skeleton-feature"><Block className="qb-skeleton-line short" /><Block className="qb-skeleton-title" /><Block className="qb-skeleton-line medium" /></div>
      <div className="qb-queue-stats">{[0, 1, 2].map((item) => <div key={item}><Block className="qb-skeleton-number" /><Block className="qb-skeleton-line short" /></div>)}</div>
      <div className="qb-panel qb-skeleton-list"><Block className="qb-skeleton-title" />{[0, 1, 2].map((item) => <div className="qb-skeleton-list-row" key={item}><Block className="qb-skeleton-avatar" /><div><Block className="qb-skeleton-line medium" /><Block className="qb-skeleton-line short" /></div></div>)}</div>
    </main>
  </div>;
}

export function BookingPageSkeleton() {
  return <div className="qb-booking-grid qb-booking-skeleton" role="status" aria-label="Loading reservation details">
    <span className="qb-sr-only">Loading reservation details</span>
    <div className="qb-booking-main" aria-hidden="true">
      <section className="qb-panel"><Block className="qb-skeleton-title" /><div className="qb-skeleton-fields"><Block className="qb-skeleton-input" /><Block className="qb-skeleton-input" /></div><div className="qb-time-picker"><div className="qb-time-periods">{[0, 1, 2].map((index) => <Block className="qb-time-period-skeleton" key={index} />)}</div><div className="qb-time-grid">{[0, 1, 2, 3, 4, 5].map((index) => <Block className="qb-time-option-skeleton" key={index} />)}</div></div></section>
      <section className="qb-panel"><Block className="qb-skeleton-title" /><Block className="qb-skeleton-map" /></section>
    </div>
    <aside className="qb-panel" aria-hidden="true"><Block className="qb-skeleton-title" />{[0, 1, 2, 3].map((item) => <div className="qb-skeleton-summary-row" key={item}><Block className="qb-skeleton-line short" /><Block className="qb-skeleton-line short" /></div>)}<Block className="qb-skeleton-button" /></aside>
  </div>;
}

export function QueuePageSkeleton() {
  return <div className="qb-queue-layout qb-queue-skeleton" role="status" aria-label="Loading live queue">
    <span className="qb-sr-only">Loading live queue</span>
    <section className="qb-panel" aria-hidden="true"><Block className="qb-skeleton-line short" /><Block className="qb-skeleton-heading" /><Block className="qb-skeleton-line medium" /><div className="qb-skeleton-fields"><Block className="qb-skeleton-input" /><Block className="qb-skeleton-input" /></div><Block className="qb-skeleton-input" /><Block className="qb-skeleton-button" /></section>
    <aside className="qb-panel" aria-hidden="true"><Block className="qb-skeleton-avatar" /><Block className="qb-skeleton-title" /><Block className="qb-skeleton-number" /><Block className="qb-skeleton-line short" /><Block className="qb-skeleton-number" /><Block className="qb-skeleton-line short" /></aside>
  </div>;
}

export function BillPanelSkeleton() {
  return <section className="qb-panel qb-bill-panel qb-bill-skeleton" role="status" aria-label="Loading bill">
    <span className="qb-sr-only">Loading bill</span>
    <Block className="qb-skeleton-line short" /><Block className="qb-skeleton-title" />
    <div className="qb-skeleton-list-row"><Block className="qb-skeleton-avatar" /><div><Block className="qb-skeleton-line medium" /><Block className="qb-skeleton-line short" /></div></div>
    <div className="qb-skeleton-list-row"><Block className="qb-skeleton-avatar" /><div><Block className="qb-skeleton-line medium" /><Block className="qb-skeleton-line short" /></div></div>
    <Block className="qb-skeleton-input" /><Block className="qb-skeleton-input" /><Block className="qb-skeleton-input" /><Block className="qb-skeleton-button" />
  </section>;
}
