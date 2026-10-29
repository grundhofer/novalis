import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import Icon from "./Icon";

/**
 * The catalog sentences that leave the system's own text to „Details“
 * (TXT-07, spec/07 §4.1): their `{{detail}}` is a code or an OS message,
 * never part of the sentence.
 */
const WITH_DETAILS = new Set([
  "errors.io",
  "errors.parse",
  "errors.parseUnknown",
  "errors.internal",
  "errors.badRequest",
]);

/** The technical text an error's sentence leaves out, if it has one. */
export function detailsOf(key: string, values: Record<string, string | number>): string | null {
  if (!WITH_DETAILS.has(key)) return null;
  const detail = values.detail;
  return typeof detail === "string" && detail.trim() !== "" ? detail : null;
}

/**
 * sebaro's error details (`details.sb-details`, spec/02 §3.28, D102 (23)):
 * right after an error's sentence, closed at first, the summary „Details“
 * with `chevron-down--16`, then the text as the system wrote it in a
 * `samp` (sebaro Mono, never hyphenated). A `<wbr>` after each „/“, „_“ and
 * „.“ lets a path break between its parts first.
 */
export default function ErrorDetails({ text }: { text: string }) {
  const { t } = useTranslation();
  const parts = text.split(/(?<=[/_.])/u);
  return (
    <details className="sb-details">
      <summary>
        <Icon name="chevron-down" />
        {t("errors.details")}
      </summary>
      <samp className="sb-details__text">
        {parts.map((part, index) => (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 && <wbr />}
          </Fragment>
        ))}
      </samp>
    </details>
  );
}
