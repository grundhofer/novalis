import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useCalloutArea } from "../lib/calloutArea";
import CloudHint from "./CloudHint";
import LegacyHint from "./LegacyHint";

/**
 * The cloud and migration hints above the document, in sebaro's callout
 * area (spec/02 §3.11, D142; ADR-0051 #90): at most 40 % of the panel, or
 * what leaves 20rem for the rest where that is more, and what does not fit
 * scrolls in it with D134's sign, so a low window keeps the tool row and the
 * writing area. A change on disk asks for a decision and stands outside it
 * (`Banner`). Without a hint the area is empty and not shown (app.css).
 */
export default function DocHints() {
  const { t } = useTranslation();
  const area = useRef<HTMLDivElement>(null);
  useCalloutArea(area);
  return (
    <div ref={area} className="sb-callout-area nv-doc-hints" role="region" aria-label={t("banner.area")}>
      <CloudHint />
      <LegacyHint />
    </div>
  );
}
