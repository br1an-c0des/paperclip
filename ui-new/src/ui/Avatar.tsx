import type { AgentAppearance, AgentAvatarSize, CharacterState } from "@paperclipai/shared";
// A runtime import from the shared package, an exception to the `import type` rule (decisions.md,
// entry 9): the avatar URL and the palette fallback must match what the server renders.
import { agentAvatarUrl, characterStateForAgent, resolveAgentAppearance } from "@paperclipai/shared/agent-appearance";
import { createMemo, createSignal, Show } from "solid-js";
import "./Avatar.css";

/*
 * Avatars (design-system.md, "Avatars"). Agents are ClipLab characters, rendered by the server as
 * PNGs (`/api/agent-avatars/...`) with the pose picked from the agent's status. Below 24px, or when
 * the image fails, a gradient initials disc stands in. People get an initials disc; the signed-in
 * person's is --primary.
 */

/** Gradient pairs the boards use for initials discs, at 160deg. */
const DISC_GRADIENTS: readonly [string, string][] = [
  ["#2fd12f", "#22b5a5"],
  ["#ff2bd6", "#f2286f"],
  ["#f7b52f", "#f5822a"],
  ["#f2272c", "#ff2bd6"],
  ["#6a93ad", "#a9c6d6"],
  ["#ff2bd6", "#8b2cf0"],
  ["#3b3df5", "#22b5a5"],
];

function hash(seed: string) {
  let value = 0;
  for (const char of seed) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function discGradient(seed: string) {
  const [a, b] = DISC_GRADIENTS[hash(seed) % DISC_GRADIENTS.length]!;
  return `linear-gradient(160deg, ${a}, ${b})`;
}

/** A gradient disc with initials. `you` draws the signed-in person's --primary disc. */
export function InitialsDisc(props: { name: string; seed?: string; size?: number; you?: boolean; label?: string }) {
  const size = () => props.size ?? 26;
  return (
    <span
      class="disc-avatar"
      classList={{ "disc-avatar--you": props.you }}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "font-size": `${Math.max(8, Math.round(size() * 0.36))}px`,
        background: props.you ? undefined : discGradient(props.seed ?? props.name),
      }}
    >
      {initials(props.name)}
    </span>
  );
}

export type AvatarAgent = { id: string; name: string; appearance?: AgentAppearance | null; status?: string };

/**
 * An agent's ClipLab avatar. `ring` draws the 2px Ion ring of a running agent; by default it follows
 * the agent's status.
 */
export function AgentAvatar(props: {
  agent: AvatarAgent;
  size?: AgentAvatarSize;
  pose?: CharacterState;
  ring?: boolean;
  label?: string;
}) {
  const size = () => props.size ?? 32;
  const appearance = createMemo(() => resolveAgentAppearance(props.agent.appearance, props.agent.id));
  const pose = () => props.pose ?? (props.agent.status ? characterStateForAgent(props.agent.status) : "rest");
  const src = () => agentAvatarUrl(appearance(), size(), 1, pose());
  const src2x = () => (appearance().customAvatarAssetId ? undefined : `${agentAvatarUrl(appearance(), size(), 2, pose())} 2x`);
  const [failed, setFailed] = createSignal<string | null>(null);
  const ring = () => props.ring ?? props.agent.status === "running";

  return (
    <span
      class="agent-avatar"
      classList={{ "agent-avatar--ring": ring() }}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <Show
        when={size() >= 24 && failed() !== src()}
        fallback={<InitialsDisc name={props.agent.name} seed={props.agent.id} size={size()} />}
      >
        <img
          src={src()}
          srcset={src2x()}
          alt=""
          width={size()}
          height={size()}
          decoding="async"
          loading="lazy"
          onError={() => setFailed(src())}
        />
      </Show>
    </span>
  );
}
