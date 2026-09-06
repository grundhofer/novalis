import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  commands,
  events,
  unwrap,
  type SearchEventDto,
  type SearchHitDto,
  type SearchReportDto,
  type TagCountDto,
} from "../ipc/client";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import "../styles/overlay.css";

/**
 * Vault-wide search (`Shift+Cmd+F`), streamed over a channel.
 *
 * Results arrive in batches while the scan runs, so the first hits are on
 * screen long before the last folder is read (PLAN.md §11.3: 300 ms p95 to
 * first results on a 10k-note vault). Starting a new search supersedes the old
 * one in the shell; there is nothing to cancel here.
 */

const DEBOUNCE_MS = 180;
const MAX_RESULTS = 400;

export default function SearchPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<TagCountDto[]>([]);
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [report, setReport] = useState<SearchReportDto | null>(null);
  const [running, setRunning] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // The tag list comes from the cache, which indexes in the background: load
  // it once and again whenever a scan finishes, rather than on a timer.
  useEffect(() => {
    const load = () => {
      void unwrap(commands.tags())
        .then((list) => setTags(list.tags))
        .catch(() => setTags([]));
    };
    load();
    const unlisten = events.cacheUpdated.listen(load);
    return () => void unlisten.then((stop) => stop());
  }, []);

  const run = useCallback(async () => {
    if (query.trim().length === 0) {
      setHits([]);
      setReport(null);
      return;
    }
    setRunning(true);
    setHits([]);
    setReport(null);
    const channel = new Channel<SearchEventDto>();
    channel.onmessage = (event) => {
      if (event.kind === "hits") {
        setHits((current) =>
          current.length >= MAX_RESULTS ? current : [...current, ...event.hits].slice(0, MAX_RESULTS),
        );
      } else {
        setReport(event.report);
      }
    };
    try {
      await unwrap(
        commands.search(
          {
            query,
            regex,
            caseSensitive,
            folder: null,
            tag: tag.trim() === "" ? null : tag.trim(),
            limit: MAX_RESULTS,
            allFiles: false,
          },
          channel,
        ),
      );
    } finally {
      setRunning(false);
    }
  }, [query, regex, caseSensitive, tag]);

  useEffect(() => {
    const timer = setTimeout(() => void run(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  const close = () => useUi.getState().setOverlay({ kind: "none" });

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prompt" aria-hidden="true" />
          <input
            className="palette-text"
            ref={input}
            value={query}
            placeholder={t("editor.search.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close();
            }}
          />
          <button
            className={caseSensitive ? "kbd on" : "kbd"}
            type="button"
            title={t("editor.find.caseSensitive")}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            {t("editor.find.caseSensitive")}
          </button>
          <button
            className={regex ? "kbd on" : "kbd"}
            type="button"
            title={t("editor.find.regex")}
            onClick={() => setRegex((v) => !v)}
          >
            {t("editor.find.regex")}
          </button>
          <input
            className="palette-filter"
            list="search-tags"
            value={tag}
            placeholder={t("editor.search.filterTag")}
            aria-label={t("editor.search.filterTag")}
            onChange={(event) => setTag(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close();
            }}
          />
          <datalist id="search-tags">
            {tags.map((entry) => (
              <option key={entry.tag} value={entry.tag} />
            ))}
          </datalist>
          {tag !== "" && (
            <button
              className="kbd"
              type="button"
              title={t("editor.search.clearFilters")}
              onClick={() => setTag("")}
            >
              {t("editor.search.clearFilters")}
            </button>
          )}
        </div>

        <div className="results">
          {running && hits.length === 0 && <div className="result empty">{t("editor.search.searching")}</div>}
          {!running && hits.length === 0 && query.trim() !== "" && (
            <div className="result empty">{t("editor.search.noResults")}</div>
          )}
          {hits.map((hit) => (
            <div
              className="result"
              key={`${hit.path}:${hit.line}`}
              onClick={() => {
                close();
                void useTabs.getState().open(hit.path);
              }}
            >
              <span className="result-glyph" />
              <span className="result-label">{hit.snippet}</span>
              <span className="result-meta">{hit.path}</span>
            </div>
          ))}
        </div>

        <div className="palette-foot">
          {report && <span>{t("editor.search.results", { count: report.matches })}</span>}
          {report && report.cloudOnlySkipped > 0 && (
            <span>{t("editor.search.cloudOnlySkipped", { count: report.cloudOnlySkipped })}</span>
          )}
          {report?.truncated && <span>{t("editor.search.truncated", { count: MAX_RESULTS })}</span>}
        </div>
      </div>
    </div>
  );
}
