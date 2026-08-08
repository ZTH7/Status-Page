import { useEffect } from "react";

import { publicConfig } from "../generated/public-config";
import { IncidentList } from "./components/IncidentList";
import { OverallStatus } from "./components/OverallStatus";
import { SearchField } from "./components/SearchField";
import { ServiceCard } from "./components/ServiceCard";
import { SiteHeader } from "./components/SiteHeader";
import { useColorMode } from "./hooks/useColorMode";
import { useMonitorSearch } from "./hooks/useMonitorSearch";
import { useStatus } from "./hooks/useStatus";
import { themeDecorations } from "./theme-registry";

export function App(props: { fetcher?: typeof fetch }): React.ReactElement {
  const status = useStatus(props.fetcher);
  const colorMode = useColorMode();
  const monitors = status.kind === "ready" ? status.data.monitors : [];
  const search = useMonitorSearch(monitors);
  const site = status.kind === "ready" ? status.data.site : publicConfig;
  const PageStart = themeDecorations.pageStart;
  const PageEnd = themeDecorations.pageEnd;

  useEffect(() => {
    document.title = site.title;
  }, [site.title]);

  return (
    <div className="app-shell">
      {PageStart ? (
        <div className="theme-decoration theme-decoration--start" aria-hidden="true">
          <PageStart />
        </div>
      ) : null}

      <SiteHeader
        site={site}
        colorMode={colorMode.colorMode}
        onColorModeToggle={colorMode.toggle}
      />

      <main
        className="page-container status-main"
        aria-busy={status.kind === "loading" || undefined}
      >
        {status.kind === "loading" ? (
          <section className="load-state" role="status" aria-label="Loading status">
            <span className="load-state__indicator" aria-hidden="true" />
            <p>Loading status…</p>
          </section>
        ) : null}

        {status.kind === "unavailable" ? (
          <section
            className="load-state load-state--unavailable"
            role="status"
            aria-label="Status data unavailable"
            data-state="unknown"
          >
            <span className="load-state__unknown" aria-hidden="true">
              ?
            </span>
            <div>
              <h2>Status data unavailable</h2>
              <p>{status.message}</p>
            </div>
          </section>
        ) : null}

        {status.kind === "ready" ? (
          <>
            <OverallStatus
              level={status.data.overall}
              latestCompletedAt={status.data.latestCompletedAt}
              labels={status.data.site.labels}
            />

            <SearchField
              query={search.query}
              placeholder={status.data.site.labels.searchPlaceholder}
              inputRef={search.inputRef}
              onQueryChange={search.setQuery}
            />

            <section className="services" aria-labelledby="services-heading">
              <div className="section-heading">
                <h2 id="services-heading">Services</h2>
                <span>{status.data.site.historyDays}-day history</span>
              </div>
              <div className="service-feed">
                {search.filteredMonitors.map((monitor) => (
                  <ServiceCard
                    key={monitor.id}
                    monitor={monitor}
                    labels={status.data.site.labels}
                  />
                ))}
              </div>
              {status.data.monitors.length === 0 ? (
                <p className="empty-state">{status.data.site.labels.noServices}</p>
              ) : search.query.trim() && search.filteredMonitors.length === 0 ? (
                <p className="empty-state" role="status" aria-live="polite">
                  {status.data.site.labels.noMatches}
                </p>
              ) : null}
            </section>

            <IncidentList incidents={status.data.incidents} labels={status.data.site.labels} />
          </>
        ) : null}
      </main>

      <footer className="site-footer">
        <div className="page-container site-footer__inner">
          <span>
            Powered by <a href="https://workers.cloudflare.com/">Cloudflare Workers</a>
          </span>
        </div>
      </footer>

      {PageEnd ? (
        <div className="theme-decoration theme-decoration--end" aria-hidden="true">
          <PageEnd />
        </div>
      ) : null}
    </div>
  );
}

export default App;
