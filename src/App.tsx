import { useEffect, useMemo, useState } from "react";
import {
  DataStatusPanel,
  type ManifestLoadState,
} from "./components/DataStatusPanel";
import { SearchSection } from "./components/SearchSection";
import { FacilityStandardsClient } from "./lib/client";
import type { DataManifest } from "./lib/types";

export function App() {
  const client = useMemo(
    () => new FacilityStandardsClient({ baseUrl: import.meta.env.BASE_URL }),
    [],
  );
  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [manifestState, setManifestState] =
    useState<ManifestLoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    client.getManifest().then(
      (loaded) => {
        if (!cancelled) {
          setManifest(loaded);
          setManifestState("ready");
        }
      },
      (error: unknown) => {
        console.error(error);
        if (!cancelled) {
          setManifestState("error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <p className="eyebrow">PUBLIC DATA EXPLORER</p>
          <h1>医療機関 施設基準検索</h1>
          <p className="lead">
            医療機関名または10桁の医療機関コードから、届出受理済みの施設基準を確認できます。
          </p>
        </div>
      </header>

      <main>
        <DataStatusPanel manifest={manifest} state={manifestState} />
        <SearchSection client={client} sources={manifest?.sources ?? []} />
      </main>

      <footer>
        <p>
          住所は公式名簿に記載された情報を収録しています。電話番号は収録していません。
        </p>
      </footer>
    </>
  );
}
