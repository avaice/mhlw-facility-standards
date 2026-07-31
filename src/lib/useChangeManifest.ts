import { useEffect, useState } from "react";
import { facilityClient } from "./facilityClient";
import type { ChangeManifest } from "./types";

export type ChangeManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: ChangeManifest | null }
  | { status: "error" };

export function useChangeManifest(): ChangeManifestState {
  const [state, setState] = useState<ChangeManifestState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    facilityClient.getChangeManifest().then(
      (manifest) => {
        if (!cancelled) {
          setState({ status: "ready", manifest });
        }
      },
      (error: unknown) => {
        console.error(error);
        if (!cancelled) {
          setState({ status: "error" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
