import { useEffect, useState } from "react";
import { facilityClient } from "./facilityClient";
import type { DataManifest } from "./types";

export type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: DataManifest }
  | { status: "error" };

export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    facilityClient.getManifest().then(
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
