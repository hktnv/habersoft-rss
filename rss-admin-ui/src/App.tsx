import { resolveAdminUiConfig } from "./config/adminUiConfig";

export function App() {
  const config = resolveAdminUiConfig();

  return (
    <main className="app-shell" aria-labelledby="page-title">
      <section className="workspace-band">
        <div>
          <p className="eyebrow">Habersoft RSS</p>
          <h1 id="page-title">Admin UI Foundation</h1>
          <p className="lede">
            A tenant-facing administration surface is being prepared. This shell only verifies runtime configuration,
            deployment boundaries, and frontend platform health.
          </p>
        </div>
        <dl className="status-grid" aria-label="Foundation status">
          <div>
            <dt>UI status</dt>
            <dd>FOUNDATION_ONLY</dd>
          </div>
          <div>
            <dt>Deployment</dt>
            <dd>NOT_DEPLOYED</dd>
          </div>
          <div>
            <dt>API writes</dt>
            <dd>OUT_OF_SCOPE</dd>
          </div>
        </dl>
      </section>

      <section className="panel-grid" aria-label="Runtime boundaries">
        <article className="panel">
          <h2>Backend API contract</h2>
          <p>The shell is configured for the backend base URL below. It does not call production from tests.</p>
          <code>{config.apiBaseUrl}</code>
        </article>
        <article className="panel">
          <h2>Auth boundary</h2>
          <p>Tenant/admin browser authentication is deferred to a later bounded slice.</p>
          <ul>
            <li>No Agent key usage</li>
            <li>No embedded backend secret</li>
            <li>No token persistence</li>
          </ul>
        </article>
        <article className="panel">
          <h2>Product boundary</h2>
          <p>Business workflows, writes, dashboards, and deployment activation are intentionally absent.</p>
        </article>
      </section>
    </main>
  );
}
