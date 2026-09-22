import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { literalRanges, regexRanges } from "../lib/matchRanges";
import { openAt } from "../lib/openAt";
import { folderOf } from "../lib/paths";
import { useFiles } from "../stores/files";
import { report as reportError, useUi } from "../stores/ui";
import "../styles/overlay.css";
import Marked from "./Marked";

/**
 * Vault-wide search (`Shift+Cmd+F`), streamed over a channel.
 *
 * Results arrive in batches while the scan runs, so the first hits are on
 * screen long before the last folder is read (PLAN.md §11.3: 300 ms p95 to
 * first results on a 10k-note vault). Starting a new search supersedes the old
 * one in the shell; there is nothing to cancel here.
 *
 * A hit opens at its line (the §4.3 "per place, jump to the line"), the
 * arrows and Enter walk the results as in the palette, and the part of the
 * snippet that matched is marked. The folder filter narrows by path prefix,
 * as the tag filter narrows by tag; the core and the CLI had both already.
 * The fields take text as typed: macOS autocorrection capitalised a query
 * and held the arrow keys and Enter while its suggestion was up.
 */

const DEBOUNCE_MS = 180;
const MAX_RESULTS = 400;

export default function SearchPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [tag, setTag] = useState("");
  const [folder, setFolder] = useState("");
  const [index, setIndex] = useState(0);
  const files = useFiles((s) => s.files);
  const folders = useMemo(
    () => [...new Set(files.map(folderOf).filter((f) => f !== ""))].sort(),
    [files],
  );
  const list = useRef<HTMLDivElement | null>(null);
  const [tags, setTags] = useState<TagCountDto[]>([]);
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [report, setReport] = useState<SearchReportDto | null>(null);
  // Every listed file, not only notes (ADR-0022 point 5): the shell narrows
  // the scan to what the tree lists before the core counts its limit, so
  // every hit that arrives here opens.
  const allFiles = useUi((s) => s.searchAllFiles);
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
    return () => void unlisten.then((stop) => stop()).catch(reportError);
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
    // A new search starts at its first hit; hits streaming in keep the place.
    setIndex(0);
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
            folder: folder.trim() === "" ? null : folder.trim(),
            tag: tag.trim() === "" ? null : tag.trim(),
            limit: MAX_RESULTS,
            allFiles,
          },
          channel,
        ),
      );
    } finally {
      setRunning(false);
    }
  }, [query, regex, caseSensitive, folder, tag, allFiles]);

  useEffect(() => {
    const timer = setTimeout(() => void run().catch(reportError), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  // The chosen row stays in view while the arrows walk past the edge.
  useEffect(() => {
    list.current?.querySelector(".result.active")?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const close = () => useUi.getState().setOverlay({ kind: "none" });

  const open = (hit: SearchHitDto | undefined) => {
    if (!hit) return;
    close();
    openAt(hit.path, { line: hit.line, snippet: hit.snippet });
  };

  const rangesOf = (snippet: string) =>
    regex ? regexRanges(snippet, query, caseSensitive) : literalRanges(snippet, query, caseSensitive);

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prompt" aria-hidden="true" />
          <input
            className="palette-text"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            ref={input}
            value={query}
            placeholder={t("editor.search.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close();
              else if (event.key === "Enter") open(hits[index]);
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((i) => Math.min(i + 1, hits.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
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
          <button
            className={allFiles ? "kbd on" : "kbd"}
            type="button"
            title={t("editor.search.allFiles")}
            onClick={() => useUi.getState().toggleSearchAllFiles()}
          >
            {t("editor.search.allFiles")}
          </button>
          <input
            className="palette-filter"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
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
          <input
            className="palette-filter"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            list="search-folders"
            value={folder}
            placeholder={t("editor.search.filterFolder")}
            aria-label={t("editor.search.filterFolder")}
            onChange={(event) => setFolder(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close();
            }}
          />
          <datalist id="search-folders">
            {folders.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          {(tag !== "" || folder !== "") && (
            <button
              className="kbd"
              type="button"
              title={t("editor.search.clearFilters")}
              onClick={() => {
                setTag("");
                setFolder("");
              }}
            >
              {t("editor.search.clearFilters")}
            </button>
          )}
        </div>

        <div className="results" ref={list}>
          {running && hits.length === 0 && <div className="result empty">{t("editor.search.searching")}</div>}
          {!running && hits.length === 0 && query.trim() !== "" && (
            <div className="result empty">{t("editor.search.noResults")}</div>
          )}
          {hits.map((hit, position) => (
            <div
              className={position === index ? "result active" : "result"}
              key={`${hit.path}:${hit.line}`}
              onMouseEnter={() => setIndex(position)}
              onClick={() => open(hit)}
            >
              <span className="result-glyph" />
              <span className="result-label">
                <Marked text={hit.snippet} ranges={rangesOf(hit.snippet)} />
              </span>
              <span className="result-meta">{hit.path}</span>
            </div>
          ))}
        </div>

        <div className="palette-foot">
          {report && <span>{t("editor.search.results", { count: report.matches })}</span>}
          {report && report.cloudOnlySkipped > 0 && (
            <span>{t("editor.search.cloudOnlySkipped", { count: report.cloudOnlySkipped })}</span>
          )}
          {report && report.notUtf8Skipped > 0 && (
            <span>{t("editor.search.notUtf8Skipped", { count: report.notUtf8Skipped })}</span>
          )}
          {report?.truncated && <span>{t("editor.search.truncated", { count: MAX_RESULTS })}</span>}
        </div>
      </div>
    </div>
  );
}
