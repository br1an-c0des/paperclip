import { A } from "@solidjs/router";
import { useCompany } from "@/lib/company";
import { buttonClass } from "@/ui/Button";
import { Splash } from "./Splash";

export function NotFound() {
  return (
    <Splash
      title="Page not found"
      actions={
        <A class={buttonClass({ variant: "primary", size: "compact" })} href="/">
          Go home
        </A>
      }
    >
      Nothing lives at this address.
    </Splash>
  );
}

/**
 * A company address no page or plugin claims (App.tsx's catch-all, through PluginPageRoute): a
 * typo, an old link, or a plugin's page while that plugin is off. Drawn inside the shell, so the
 * navigation stays in reach.
 */
export function CompanyNotFound() {
  const company = useCompany();
  return (
    <section class="card" style={{ padding: "18px 22px", display: "flex", "flex-direction": "column", "align-items": "flex-start", gap: "8px" }}>
      <h1 class="disp" style={{ "font-size": "22px", "font-weight": 800 }}>
        Page not found
      </h1>
      <p style={{ color: "var(--body)" }}>Nothing lives at this address in {company().name}.</p>
      <A class={buttonClass({ variant: "primary", size: "compact" })} href={`/${company().issuePrefix}/dashboard`}>
        Go to the dashboard
      </A>
    </section>
  );
}
