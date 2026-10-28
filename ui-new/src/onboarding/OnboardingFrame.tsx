import { Check } from "lucide-solid";
import { For, Show, type JSX, type ParentProps } from "solid-js";
import { ONBOARDING_STEPS, type OnboardingStep } from "./onboarding-model";
import "@/agents/new/NewAgent.css";
import "@/projects/settings/ProjectSettings.css";
import "./Onboarding.css";

/** The page frame: eyebrow, title, and the four steps; finished steps get a check. */
export function OnboardingFrame(props: ParentProps<{ step: OnboardingStep; title: JSX.Element; organization?: string; aside?: JSX.Element; leave?: JSX.Element }>) {
  const index = () => ONBOARDING_STEPS.findIndex((entry) => entry.key === props.step);
  return (
    <main class="ob" classList={{ "ob--narrow": !props.aside }}>
      <header class="card ob-head">
        <div class="ob-head-text">
          <span class="mono cap">{props.organization ? `Onboarding · ${props.organization}` : "Onboarding"}</span>
          <h1 class="disp">{props.title}</h1>
        </div>
        <ol class="na-steps ob-steps" aria-label="Steps">
          <For each={ONBOARDING_STEPS}>
            {(entry, i) => (
              <li aria-current={i() === index() ? "step" : undefined}>
                <span class="ob-step">
                  <span class="na-step-disc" data-state={i() < index() ? "done" : i() === index() ? "current" : "todo"} aria-hidden="true">
                    <Show when={i() < index()} fallback={i() + 1}>
                      <Check size={13} stroke-width={3} />
                    </Show>
                  </span>
                  {entry.label}
                </span>
              </li>
            )}
          </For>
        </ol>
      </header>
      <div class="ob-body" classList={{ "ob-body--aside": !!props.aside }}>
        {props.children}
        {props.aside}
      </div>
      <Show when={props.leave}>
        <p class="ob-leave">{props.leave}</p>
      </Show>
    </main>
  );
}
