import { A } from "@solidjs/router";

export function NotFound() {
  return (
    <section class="card">
      <h2>Not found</h2>
      <p>
        <A href="/">Back home</A>
      </p>
    </section>
  );
}
