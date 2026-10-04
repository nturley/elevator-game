import { API_DOCS } from "./apiDocs";

/**
 * Collapsible API reference shown under the editor, rendered from the same
 * API_DOCS data that generates Monaco's autocomplete declarations.
 */
export function ApiReference() {
  return (
    <div className="api-panel">
      {API_DOCS.map((group) => (
        <section key={group.title} className="api-group">
          <h3>{group.title}</h3>
          <p className="api-group-desc">{group.description}</p>
          <ul>
            {group.methods.map((m) => (
              <li key={m.signature}>
                <code className="api-sig">{m.signature}</code>
                <span className="api-desc">{m.description}</span>
              </li>
            ))}
          </ul>
          {group.events && (
            <>
              <h4>Events</h4>
              <ul>
                {group.events.map((e) => (
                  <li key={e.name}>
                    <code className="api-sig">
                      on(&quot;{e.name}&quot;, {e.handler})
                    </code>
                    <span className="api-desc">{e.description}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
