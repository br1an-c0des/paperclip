import { createSignal, onMount, Show } from "solid-js";
import { Splash } from "@/routes/Splash";
import { Button } from "@/ui/Button";
import { clearPendingHandoff, readPendingHandoff, resumeCloudHandoff } from "./auth-model";

/*
 * `/oauth-handoff`: where Paperclip Cloud returns after refreshing your login in the middle of
 * connecting an app, after ui/src/pages/apps/PaperclipCloudOAuthHandoff.tsx. The handoff saved before
 * leaving (session storage) is traded for the provider's sign-in address, and the browser goes there.
 * Only Cloud-managed instances use it.
 */
export function OAuthHandoffPage() {
  const [error, setError] = createSignal<string | null>(null);

  const resume = async () => {
    setError(null);
    const session = readPendingHandoff();
    if (!session) return setError("This sign-in expired. Go back to Paperclip and start the connection again.");
    try {
      const url = await resumeCloudHandoff(session);
      clearPendingHandoff();
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Paperclip couldn't prepare secure sign-in.");
    }
  };
  onMount(() => void resume());

  return (
    <Show when={error()} fallback={<Splash title="Preparing secure sign-in">Paperclip is opening the provider securely.</Splash>}>
      {(message) => (
        <Splash
          title="Sign-in couldn't continue"
          actions={
            <>
              <Button variant="primary" size="compact" onClick={() => void resume()}>
                Try again
              </Button>
              <Button
                variant="quiet"
                size="compact"
                onClick={() => {
                  clearPendingHandoff();
                  window.location.assign("/");
                }}
              >
                Back to Paperclip
              </Button>
            </>
          }
        >
          {message()}
        </Splash>
      )}
    </Show>
  );
}
