import type { ReactNode } from "react";
import { translate as t, useI18n } from "../i18n";
import { prepareResources, useResourceStartup } from "./resource-startup";

/** The frontend is embedded; it can show progress while the Node resources are unpacked. */
export function ResourceStartup({ children }: { children: ReactNode }) {
  useI18n();
  const startup = useResourceStartup();
  if (startup.state === "ready") return children;
  const { progress } = startup;
  const percentage =
    progress.totalBytes > 0
      ? Math.min(99, Math.floor((progress.completedBytes / progress.totalBytes) * 100))
      : 0;
  return (
    <main className="resource-startup">
      <section aria-label={t("startup.title")} aria-busy={startup.state === "preparing"}>
        <h1>xresconv-gui</h1>
        <h2>{t("startup.title")}</h2>
        {startup.state === "error" ? (
          <>
            <p role="alert">{t("startup.error", { message: startup.error ?? "" })}</p>
            <button type="button" onClick={prepareResources}>
              {t("startup.retry")}
            </button>
          </>
        ) : (
          <>
            <p role="status">{t(`startup.${progress.phase}`)}</p>
            <progress
              max={100}
              value={progress.phase === "extracting" ? percentage : undefined}
              aria-label={t("startup.progress")}
            />
            {progress.phase === "extracting" && (
              <p>
                {t("startup.files", {
                  percent: percentage,
                  completed: progress.completedFiles,
                  total: progress.totalFiles,
                })}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
