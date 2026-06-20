import type { ProgrammeResult } from "../types/jupas";
import { useLang } from "../lib/i18n";

type Props = {
  results: ProgrammeResult[];
};

export function StrategySummary({ results }: Props) {
  const { t } = useLang();
  if (results.length === 0) return null;

  const eligibleCount = results.filter((r) => r.eligibility.eligible).length;
  const ineligibleCount = results.length - eligibleCount;
  const aboveMedianCount = results.filter((r) => r.band === "above-uq" || r.band === "above-median").length;
  const belowLqCount = results.filter((r) => r.band === "below-lq").length;
  const noScoreCount = results.filter((r) => r.band === "no-score").length;
  const bBandResults = results.slice(3, 6).filter((r): r is ProgrammeResult => !!r);
  const hasSafety = bBandResults.some((r) => r.band === "above-uq" || r.band === "above-median");

  const signals: Array<{ key: string; label: string; value: string; tone: "good" | "warn" | "neutral" }> = [
    {
      key: "eligibility",
      label: t("strategy.eligibility"),
      value: t("strategy.eligibilityValue", { n: eligibleCount, total: results.length }),
      tone: ineligibleCount === 0 ? "good" : ineligibleCount >= results.length / 2 ? "warn" : "neutral",
    },
    {
      key: "above-median",
      label: t("strategy.aboveMedian"),
      value: t("strategy.aboveMedianValue", { n: aboveMedianCount, total: results.length }),
      tone: aboveMedianCount === 0 ? "warn" : "neutral",
    },
    {
      key: "below-lq",
      label: t("strategy.belowLq"),
      value: t("strategy.belowLqValue", { n: belowLqCount }),
      tone: belowLqCount === 0 ? "good" : belowLqCount >= 2 ? "warn" : "neutral",
    },
    {
      key: "safety",
      label: t("strategy.safety"),
      value: hasSafety
        ? t("strategy.safetyHas")
        : bBandResults.length === 0
          ? t("strategy.safetyEmpty")
          : t("strategy.safetyNone"),
      tone: hasSafety ? "good" : "warn",
    },
  ];

  return (
    <section className="panel strategy-summary" aria-label={t("strategy.ariaPanel")}>
      <div className="strategy-heading">
        <p className="eyebrow">{t("strategy.eyebrow")}</p>
        <h2>{t("strategy.title")}</h2>
      </div>
      <ul className="strategy-grid">
        {signals.map((signal) => (
          <li key={signal.key} className={`strategy-cell tone-${signal.tone}`}>
            <span className="strategy-label">{signal.label}</span>
            <strong className="strategy-value">{signal.value}</strong>
          </li>
        ))}
      </ul>
      {noScoreCount > 0 ? (
        <p className="strategy-footnote">{t("strategy.footnote", { n: noScoreCount })}</p>
      ) : null}
    </section>
  );
}
