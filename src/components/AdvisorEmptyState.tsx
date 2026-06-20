import { useLang } from "../lib/i18n";

export function AdvisorEmptyState() {
  const { t } = useLang();
  return (
    <aside className="panel advisor-empty" aria-label={t("advisorEmpty.guidanceAria")}>
      <p className="eyebrow">{t("advisorEmpty.eyebrow")}</p>
      <h2>{t("advisorEmpty.title")}</h2>
      <p className="advisor-empty-lede">{t("advisorEmpty.lede")}</p>

      <h3 className="advisor-empty-heading">{t("advisorEmpty.checkHeading")}</h3>
      <ul className="advisor-empty-list">
        <li>{t("advisorEmpty.check1")}</li>
        <li>{t("advisorEmpty.check2")}</li>
        <li>{t("advisorEmpty.check3")}</li>
        <li>{t("advisorEmpty.check4")}</li>
      </ul>

      <p className="advisor-empty-footnote">{t("advisorEmpty.footnote")}</p>
    </aside>
  );
}
