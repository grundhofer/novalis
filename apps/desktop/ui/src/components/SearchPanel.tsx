import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { FileName } from "./FileName";
import Icon from "./Icon";
import Marked from "./Marked";
import SuggestField from "./SuggestField";
import { PaletteFoot, step, usePaletteFrame } from "./PaletteFrame";
import { WAIT_MS } from "./Prompt";
import Tool from "./Tool";

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
 *
 * sebaro's full-text search in the palette's frame (./PaletteFrame,
 * spec/02 §4.16, §4.25.1, D104 (1)–(4)): `data-sb-fulltext` on the frame,
 * the search row as `sb-search` with „Suche leeren“ (EIN-05), then the row
 * `__options` with the options as filter chips (`sb-chip`, `aria-pressed`,
 * `data-sb-search-option`, EIN-04; 32 px in the window's density, D104
 * (2)) and the filters as compact fields with their labels (EIN-01) that
 * suggest the vault's tags and folders (./SuggestField, NV-M12),
 * „Filter zurücksetzen“ as a compact text action (AKT-06), the hits as
 * two-line window rows (`__main`: the snippet as `__name` with the matched
 * part marked, `sb-mark`, FAR-12, and its path as `__sub`), and the counts
 * in the foot. Searching is local work: the list is `aria-busy` while it
 * runs, and „Suche läuft …“ stands in its place only once it has taken a
 * second without a hit (STA-06, D104 (4)).
 */

const DEBOUNCE_MS = 180;
const MAX_RESULTS = 400;

export default function SearchPanel() {
  const { t } = useTranslation();
  // ⇧⌘F over a selection starts with it (ADR-0037), selected, so typing
  // replaces it.
  const [query, setQuery] = useState(() => {
    const overlay = useUi.getState().overlay;
    return overlay.kind === "search" ? (overlay.query ?? "") : "";
  });
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  // A tag chosen in the palette arrives as the filter (§4.4 "tags as search
  // filter / palette").
  const [tag, setTag] = useState(() => {
    const overlay = useUi.getState().overlay;
    return overlay.kind === "search" ? (overlay.tag ?? "") : "";
  });
  const [folder, setFolder] = useState("");
  const [index, setIndex] = useState(0);
  const files = useFiles((s) => s.files);
  const folders = useMemo(
    () => [...new Set(files.map(folderOf).filter((f) => f !== ""))].sort(),
    [files],
  );
  const list = useRef<HTMLDivElement | null>(null);
  const [tags, setTags] = useState<TagCountDto[]>([]);
  const tagNames = useMemo(() => tags.map((entry) => entry.tag), [tags]);
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [report, setReport] = useState<SearchReportDto | null>(null);
  // What the last search looked for, for the sentence when it found nothing.
  const [searched, setSearched] = useState("");
  // Every listed file, not only notes (ADR-0022 point 5): the shell narrows
  // the scan to what the tree lists before the core counts its limit, so
  // every hit that arrives here opens.
  const allFiles = useUi((s) => s.searchAllFiles);
  const [running, setRunning] = useState(false);
  // The search has run a second without a hit (STA-06, spec/07 §4.5).
  const [slow, setSlow] = useState(false);
  // The latest run: an older one ending does not end its state.
  const latest = useRef(0);
  const input = useRef<HTMLInputElement | null>(null);
  const id = useId();
  const { dialog, dismiss } = usePaletteFrame(input, true);

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
    const mine = (latest.current += 1);
    if (query.trim().length === 0) {
      setHits([]);
      setReport(null);
      setRunning(false);
      setSlow(false);
      return;
    }
    setRunning(true);
    setSlow(false);
    setSearched(query.trim());
    const timer = setTimeout(() => {
      if (latest.current === mine) setSlow(true);
    }, WAIT_MS);
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
      clearTimeout(timer);
      if (latest.current === mine) {
        setRunning(false);
        setSlow(false);
      }
    }
  }, [query, regex, caseSensitive, folder, tag, allFiles]);

  useEffect(() => {
    const timer = setTimeout(() => void run().catch(reportError), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  // The chosen row stays in view while the arrows walk past the edge.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const open = (hit: SearchHitDto | undefined) => {
    if (!hit) return;
    dismiss();
    openAt(hit.path, { line: hit.line, snippet: hit.snippet });
  };

  const rangesOf = (snippet: string) =>
    regex ? regexRanges(snippet, query, caseSensitive) : literalRanges(snippet, query, caseSensitive);

  const placeholder = t("editor.search.placeholder");
  const optionId = (position: number) => `${id}-o${position}`;
  const typed = query.trim();
  // DAT-07 / NAV-09: a search that has ended without a hit says what it
  // looked for.
  const empty =
    hits.length > 0 || typed === ""
      ? ""
      : running
        ? slow
          ? t("editor.search.searching")
          : ""
        : report
          ? t(allFiles ? "editor.search.noFile" : "editor.search.noNote", { query: searched })
          : "";

  return (
    <dialog
      className="sb-command-palette"
      data-sb-density="window"
      data-sb-fulltext=""
      aria-label={t("editor.search.title")}
      {...dialog}
    >
      <div className="sb-command-palette__search sb-search">
        <Icon name="search" size={20} />
        <input
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={hits[index] ? optionId(index) : undefined}
          aria-label={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          ref={input}
          value={query}
          placeholder={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              open(hits[index]);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => step(i, hits.length, event.key === "ArrowUp"));
            }
          }}
        />
        {/* „Suche leeren“ while the field has text (spec/02 §2.2, EIN-05);
            the focus stays in the field. */}
        {query !== "" && (
          <Tool
            id={`${id}-clear`}
            icon="close"
            label={t("editor.search.clear")}
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          />
        )}
      </div>

      <div className="sb-command-palette__options">
        <div className="sb-chips" role="group" aria-label={t("editor.find.options")}>
          <button
            className="sb-chip"
            type="button"
            aria-pressed={caseSensitive}
            data-sb-search-option="case"
            onClick={() => setCaseSensitive((v) => !v)}
          >
            <Icon name="check" />
            {t("editor.find.caseSensitive")}
          </button>
          <button
            className="sb-chip"
            type="button"
            aria-pressed={regex}
            data-sb-search-option="regex"
            onClick={() => setRegex((v) => !v)}
          >
            <Icon name="check" />
            {t("editor.find.regex")}
          </button>
          <button
            className="sb-chip"
            type="button"
            aria-pressed={allFiles}
            onClick={() => useUi.getState().toggleSearchAllFiles()}
          >
            <Icon name="check" />
            {t("editor.search.allFiles")}
          </button>
        </div>
        {/* The filters suggest the vault's tags and folders in sebaro's
            field with suggestions (spec/02 §4.26, NV-M12), not a datalist. */}
        <SuggestField
          label={t("editor.search.filterTag")}
          listLabel={t("editor.search.filterTag")}
          value={tag}
          suggestions={tagNames}
          onChange={setTag}
        />
        <SuggestField
          label={t("editor.search.filterFolder")}
          listLabel={t("editor.search.filterFolder")}
          value={folder}
          suggestions={folders}
          onChange={setFolder}
        />
        {(tag !== "" || folder !== "") && (
          <button
            className="sb-text-action sb-text-action--compact"
            type="button"
            onClick={() => {
              setTag("");
              setFolder("");
            }}
          >
            {t("editor.search.clearFilters")}
          </button>
        )}
      </div>

      {/* A press on a hit keeps the focus in the field (§4.16). */}
      <div
        className="sb-command-palette__list"
        id={`${id}-list`}
        role="listbox"
        aria-label={t("editor.search.title")}
        aria-busy={running || undefined}
        ref={list}
        onMouseDown={(event) => event.preventDefault()}
      >
        {hits.map((hit, position) => (
          <div
            className="sb-row"
            role="option"
            id={optionId(position)}
            aria-selected={position === index}
            key={`${hit.path}:${hit.line}`}
            onClick={() => open(hit)}
          >
            <span className="sb-row__check" aria-hidden="true" />
            <span className="sb-row__main">
              <span className="sb-row__name">
                {/* The core marks a cut start with „…“ in the text and a cut
                    end only in the flag; the row wraps, so the cut shows
                    (ADR-0051 #24). */}
                <Marked text={hit.snippetCutEnd ? `${hit.snippet}…` : hit.snippet} ranges={rangesOf(hit.snippet)} />
              </span>
              <span className="sb-row__sub">
                <FileName name={hit.path} />
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="sb-command-palette__empty" role="status">
        {empty}
      </p>

      <PaletteFoot verbKey="palette.foot.open">
        {report && <span>{t("editor.search.results", { count: report.matches })}</span>}
        {report && report.cloudOnlySkipped > 0 && (
          <span>{t("editor.search.cloudOnlySkipped", { count: report.cloudOnlySkipped })}</span>
        )}
        {report && report.notUtf8Skipped > 0 && (
          <span>{t("editor.search.notUtf8Skipped", { count: report.notUtf8Skipped })}</span>
        )}
        {report?.truncated && <span>{t("editor.search.truncated", { count: MAX_RESULTS })}</span>}
      </PaletteFoot>
    </dialog>
  );
}
