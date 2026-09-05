#!/usr/bin/env python3
"""Generate a synthetic novalis vault for tests and benchmarks.

Deterministic: names, bodies, links, board files and mtimes derive from --seed
and the other arguments, never from the clock or the machine, so the manifest of
one run equals the manifest of the next. Standard library only.

    python3 fixtures/gen/gen_vault.py /tmp/vault-10k
    python3 fixtures/gen/gen_vault.py /tmp/vault-50k --size 50000
    python3 fixtures/gen/gen_vault.py /tmp/vault-200 --count 200 --legacy-config

What it writes (manifest.json lists every special item):
  * N Markdown notes (default 10000) across top-level folders and a deep chain
  * a few ~2 MB notes
  * umlaut (NFC) and NFD-encoded file and folder names, wikilinks in both forms
  * case-only twins (same folder on case-sensitive volumes, sibling folders
    otherwise) and cross-folder duplicate stems
  * conflict-copy names: OneDrive "<stem>-MacBook-Pro.md", Dropbox
    "<stem> (MacBook-Pro's conflicted copy YYYY-MM-DD).md", generic
    "<stem> (1).md", one with identical bytes, one for a .txt, one look-alike
    without an original
  * notes under boards/ (directly, inside a board folder, in a folder that has
    cards/ but no board.json)
  * boards/atlas/ and boards/harbor/ with board.json + cards/<ULID>.json per
    PLAN.md section 8.2: a conflict sibling that wins on `updated`, an
    identical-bytes sibling, a tombstone, a card in a missing column, a card
    with an unknown key, a card linking a missing note, a card linking an NFD
    note in NFC form
  * non-UTF-8, CRLF and empty notes, broken frontmatter, other file types,
    files the watcher must ignore
  * cloud-only stand-ins: sparse files (size > 0, no allocated blocks)
  * .novalis/vault.json (and a legacy .novalis/config.json with --legacy-config)

Exit codes: 0 ok, 2 usage or refused target.
"""

import argparse
import calendar
import json
import os
import random
import shutil
import sys
import unicodedata
from datetime import datetime, timezone

HOST = "MacBook-Pro"
BASE_TS = calendar.timegm((2026, 9, 1, 0, 0, 0))  # 2026-09-01T00:00:00Z
SPAN_DAYS = 400
GENERATOR = "fixtures/gen/gen_vault.py"
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

WORDS_DE = (
    "Notiz Entwurf Idee Karte Vault Ordner Synchronisierung Konflikt Entscheidung "
    "Rendering Bündel Offline Zoom Stufe Küste Straße Übersicht Rückblick Größe "
    "Bäume Zähler Fenster Tastatur Palette Suche Verweis Überschrift Absatz Liste "
    "Aufgabe Zitat Tabelle Werkzeug Agent Skizze Prüfung Messung Budget Fehler "
    "Hafen Atlas Kompass Leuchtturm Wetter Tagebuch Lesung Forschung Sitzung "
    "Protokoll Plan Woche Monat Jahr Archiv Quelle Ziel Spur Zettel Garten Brücke "
    "Turm Wald Fluss Insel Karte Route Lager Mühle Feld Werkstatt"
).split()
WORDS_EN = (
    "note draft idea card vault folder sync conflict decision rendering bundle "
    "offline zoom level coast street overview review size trees counter window "
    "keyboard palette search reference heading paragraph list task quote table "
    "tool agent sketch check measure budget error harbor atlas compass lighthouse "
    "weather journal reading research session minutes plan week month year "
    "archive source target trail slip garden bridge tower forest river island "
    "route depot mill field workshop"
).split()
TAGS = (
    "pkm ux atlas harbor sync offline markdown kanban cli agent design perf "
    "research reading meeting journal idee entwurf archiv prüfung"
).split()
TOP_FOLDERS = [
    ("", 2),
    ("journal", 8),
    ("projects/atlas", 8),
    ("projects/harbor", 8),
    ("research", 12),
    ("reading", 10),
    ("meetings", 6),
    ("archive/2024", 6),
    ("archive/2025", 6),
    ("notizen/persönlich", 5),
    ("notizen/arbeit", 5),
]


def nfd(s):
    return unicodedata.normalize("NFD", s)


def iso(ts, ms=0, suffix="Z"):
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    if suffix == "Z":
        return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms:03d}Z"
    return d.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def ulid(ts_ms, rng):
    n = (ts_ms << 80) | rng.getrandbits(80)
    out = []
    for _ in range(26):
        out.append(CROCKFORD[n & 31])
        n >>= 5
    return "".join(reversed(out))


def dump_json(obj):
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


class Vault:
    def __init__(self, root, rng, args):
        self.root = root
        self.rng = rng
        self.args = args
        self.notes = []  # dicts: path, stem, folder, title, ts, kind
        self.links_total = 0
        self.links_unresolved = 0
        self.unresolved_targets = []
        self.titles_differ = 0
        self.with_frontmatter = 0
        self.with_tags = 0
        self.manifest = {
            "generator": GENERATOR,
            "args": {
                "count": args.count,
                "seed": args.seed,
                "large": args.large,
                "depth": args.depth,
                "legacyConfig": args.legacy_config,
                "cloudStandIns": not args.no_cloud_stand_ins,
                "marker": not args.no_marker,
            },
        }

    # ---- filesystem helpers -------------------------------------------------
    def abs_path(self, rel):
        return os.path.join(self.root, *rel.split("/"))

    def write(self, rel, data, ts=None):
        p = self.abs_path(rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if isinstance(data, str):
            data = data.encode("utf-8")
        with open(p, "wb") as f:
            f.write(data)
        if ts is not None:
            os.utime(p, (ts, ts))
        return len(data)

    def ts(self):
        return BASE_TS - self.rng.randrange(0, SPAN_DAYS * 86400)

    # ---- note records --------------------------------------------------------
    def add_note(self, rel, title=None, kind="regular", ts=None):
        stem = rel.rsplit("/", 1)[-1][:-3]
        folder = rel.rsplit("/", 1)[0] if "/" in rel else ""
        rec = {
            "path": rel,
            "stem": stem,
            "folder": folder,
            "title": title if title is not None else stem,
            "ts": ts if ts is not None else self.ts(),
            "kind": kind,
        }
        self.notes.append(rec)
        return rec

    def words(self, n, lang=None):
        pool = WORDS_DE if (lang or self.rng.choice(("de", "en"))) == "de" else WORDS_EN
        return " ".join(self.rng.choice(pool) for _ in range(n))

    def sentence(self):
        s = self.words(self.rng.randint(8, 18))
        return s[0].upper() + s[1:] + "."

    def paragraph(self):
        return " ".join(self.sentence() for _ in range(self.rng.randint(2, 5)))

    # ---- link rendering ------------------------------------------------------
    def link_to(self, src, dst):
        r = self.rng.random()
        self.links_total += 1
        if r < 0.60:
            return f"[[{dst['stem']}]]"
        if r < 0.75:
            return f"[[{dst['stem']}|{self.words(2)}]]"
        if r < 0.85:
            return f"[[{dst['stem']}#Kontext]]"
        if r < 0.95:
            return f"[[{dst['folder'] + '/' if dst['folder'] else ''}{dst['stem']}]]"
        rel = os.path.relpath(dst["path"], start=src["folder"] or ".")
        rel = rel.replace(os.sep, "/")
        if self.rng.random() < 0.5:
            rel = rel.replace(" ", "%20")
        return f"[{self.words(2)}]({rel})"

    # ---- bodies --------------------------------------------------------------
    def frontmatter(self, rec, variant):
        if variant == "none":
            return ""
        lines = ["---", f"title: {rec['title']}"]
        if variant == "full":
            created = rec["ts"] - self.rng.randrange(0, 90 * 86400)
            lines.append(f"created: {iso(created, suffix='+00:00')}")
            lines.append(f"modified: {iso(rec['ts'], suffix='+00:00')}")
            if self.rng.random() < 0.55:
                tags = self.rng.sample(TAGS, self.rng.randint(1, 3))
                lines.append(f"tags: [{', '.join(tags)}]")
                self.with_tags += 1
        lines.append("---")
        self.with_frontmatter += 1
        return "\n".join(lines) + "\n"

    def body(self, rec, targets, size_target=None):
        out = []
        variant = self.rng.choices(["full", "title", "none"], [80, 10, 10])[0]
        out.append(self.frontmatter(rec, variant))
        out.append(f"# {rec['title']}\n\n")
        n_par = self.rng.randint(1, 5)
        link_iter = iter(targets)
        for i in range(n_par):
            par = self.paragraph()
            t = next(link_iter, None)
            if t is not None:
                par += " Siehe " + self.link_to(rec, t) + "."
            out.append(par + "\n\n")
            if i == 1:
                out.append("## Kontext\n\n")
            if i == 3:
                out.append("## Kontext\n\n")  # duplicate heading on purpose
        for t in link_iter:  # remaining links in a list
            out.append(f"- {self.link_to(rec, t)}\n")
        out.append("\n")
        out.append("## Aufgaben\n\n")
        for _ in range(self.rng.randint(1, 3)):
            box = "x" if self.rng.random() < 0.4 else " "
            out.append(f"- [{box}] {self.sentence()}\n")
        out.append("\n> " + self.sentence() + "\n\n")
        out.append("```json\n" + json.dumps({"id": rec["stem"], "ok": True}) + "\n```\n\n")
        if self.rng.random() < 0.40:
            out.append(" ".join("#" + t for t in self.rng.sample(TAGS, 2)) + "\n")
        text = "".join(out)
        if size_target:
            filler = ("\n## Abschnitt\n\n" + self.paragraph() + "\n") * 8
            while len(text.encode("utf-8")) < size_target:
                text += filler
        return text

    # ---- generation steps ----------------------------------------------------
    def plan_regular(self, count):
        folders, weights = zip(*TOP_FOLDERS)
        deep = ["tief"] + [f"tief/{'/'.join(f'ebene-{d}' for d in range(1, k + 1))}" for k in range(1, self.args.depth + 1)]
        self.manifest["deepestFolder"] = deep[-1]
        journal_k = 0
        used = set(n["path"] for n in self.notes)
        for i in range(count):
            if i < len(deep):
                folder = deep[i]
            else:
                folder = self.rng.choices(folders, weights)[0]
                if self.rng.random() < 0.02:
                    folder = self.rng.choice(deep)
            if folder == "journal":
                day = BASE_TS - journal_k * 86400
                journal_k += 1
                stem = datetime.fromtimestamp(day, tz=timezone.utc).strftime("%Y-%m-%d")
                title = stem
                ts = day + 8 * 3600
            else:
                w1 = self.rng.choice(WORDS_DE if self.rng.random() < 0.6 else WORDS_EN)
                w2 = self.rng.choice(WORDS_EN if self.rng.random() < 0.5 else WORDS_DE)
                stem = f"{w1.capitalize()} {w2} {i:05d}"
                r = self.rng.random()
                if r < 0.70:
                    title = stem
                elif r < 0.85:
                    title = f"{w1.capitalize()} {w2}: {self.words(2)}"
                    self.titles_differ += 1
                elif r < 0.92:
                    title = f"{w1.capitalize()} / {w2}"
                    self.titles_differ += 1
                else:
                    title = self.words(3).title()
                    self.titles_differ += 1
                ts = None
            rel = f"{folder}/{stem}.md" if folder else f"{stem}.md"
            if rel in used:
                continue
            used.add(rel)
            self.add_note(rel, title=title, ts=ts)

    def plan_specials(self):
        m = self.manifest
        m["unicodeNames"] = []
        for rel in ["Übersicht Straße.md", "research/Zürich Reise.md", "notizen/persönlich/Größenordnung.md"]:
            self.add_note(unicodedata.normalize("NFC", rel), kind="unicode")
            m["unicodeNames"].append({"path": unicodedata.normalize("NFC", rel), "form": "NFC"})
        for rel in ["research/Café Notizen.md", "notizen/arbeit/Ärger mit Sync.md", "notizen/übungen/Übung eins.md"]:
            self.add_note(nfd(rel), kind="unicode")
            m["unicodeNames"].append({"path": nfd(rel), "form": "NFD", "nfc": unicodedata.normalize("NFC", rel)})
        # case-only twins
        probe = os.path.join(self.root, ".probe-CASE")
        open(probe, "w").close()
        case_insensitive = os.path.exists(os.path.join(self.root, ".probe-case"))
        os.remove(probe)
        if case_insensitive:
            twins = [("projects/atlas/Readme.md", "projects/harbor/readme.md")]
            m["caseTwinStrategy"] = "sibling-folders (target volume is case-insensitive)"
        else:
            twins = [("projects/Readme.md", "projects/readme.md")]
            m["caseTwinStrategy"] = "same-folder (target volume is case-sensitive)"
        twins.append(("research/Local-First.md", "reading/local-first.md"))
        for a, b in twins:
            self.add_note(a, kind="case-twin")
            self.add_note(b, kind="case-twin")
        m["caseTwins"] = twins
        # duplicate stems across folders
        dups = [("index.md", "reading/index.md"), ("projects/atlas/Overview.md", "projects/harbor/Overview.md")]
        for a, b in dups:
            self.add_note(a, kind="duplicate-stem")
            self.add_note(b, kind="duplicate-stem")
        m["duplicateStems"] = dups
        # notes under boards/
        under = ["boards/Ideensammlung.md", "boards/atlas/Retro.md", "boards/not-a-board/Notes.md"]
        for rel in under:
            self.add_note(rel, kind="under-boards")
        m["notesUnderBoards"] = under
        # crlf, empty, broken frontmatter, large
        m["crlf"] = [f"archive/2025/CRLF Notiz {i}.md" for i in range(5)]
        for rel in m["crlf"]:
            self.add_note(rel, kind="crlf")
        m["empty"] = ["Leer.md"]
        self.add_note("Leer.md", kind="empty")
        m["brokenFrontmatter"] = ["archive/2024/Kaputt eins.md", "archive/2024/Kaputt zwei.md"]
        for rel in m["brokenFrontmatter"]:
            self.add_note(rel, kind="broken-frontmatter")
        m["largeNotes"] = []
        for i in range(self.args.large):
            rel = f"archive/Große Notiz {i}.md"
            self.add_note(rel, kind="large")

    def write_notes(self):
        m = self.manifest
        regular = [n for n in self.notes if n["kind"] == "regular"]
        unicode_notes = [n for n in self.notes if n["kind"] == "unicode"]
        by_kind_bytes = 0
        for idx, rec in enumerate(self.notes):
            kind = rec["kind"]
            if kind == "empty":
                by_kind_bytes += self.write(rec["path"], "", rec["ts"])
                continue
            k = self.rng.choices([0, 1, 2, 3, 4, 5], [15, 30, 25, 15, 10, 5])[0]
            pool = regular if len(regular) >= 8 else self.notes
            targets = [t for t in self.rng.sample(pool, min(k, len(pool))) if t is not rec]
            if self.rng.random() < 0.15 and unicode_notes:
                targets.append(self.rng.choice(unicode_notes))
            if kind == "broken-frontmatter":
                text = ("---\ntitle: [unclosed\n---\n" if rec["path"].endswith("eins.md") else "---\ntitle: Kaputt zwei\ncreated: 2026-01-01\n")
                text += f"# {rec['title']}\n\n{self.paragraph()}\n"
            elif kind == "large":
                text = self.body(rec, targets, size_target=2 * 1024 * 1024)
                m["largeNotes"].append({"path": rec["path"], "bytes": len(text.encode("utf-8"))})
            else:
                text = self.body(rec, targets)
            if self.rng.random() < 0.01:
                n = len(self.unresolved_targets)
                target = f"Nirgendwo {n}"
                self.unresolved_targets.append(target)
                self.links_total += 1
                self.links_unresolved += 1
                text += f"\nSiehe auch [[{target}]].\n"
            if kind == "crlf":
                text = text.replace("\n", "\r\n")
            by_kind_bytes += self.write(rec["path"], text, rec["ts"])
        m["counts"] = {
            "notesTotal": len(self.notes),
            "notesRegular": len(regular),
            "notesSpecial": len(self.notes) - len(regular),
            "notesWithFrontmatter": self.with_frontmatter,
            "notesWithFrontmatterTags": self.with_tags,
            "titlesDifferFromStem": self.titles_differ,
            "linksTotal": self.links_total,
            "linksUnresolved": self.links_unresolved,
            "noteBytes": by_kind_bytes,
        }
        m["unresolvedLinkTargets"] = self.unresolved_targets

    def write_conflict_copies(self):
        m = self.manifest
        regular = [n for n in self.notes if n["kind"] == "regular"]
        picks = self.rng.sample(regular, 4)
        entries = []

        def copy_of(rec, name, identical):
            src = self.abs_path(rec["path"])
            with open(src, "rb") as f:
                data = f.read()
            if not identical:
                data += b"\nZeile vom zweiten Ger\xc3\xa4t.\n"
            rel = f"{rec['folder']}/{name}" if rec["folder"] else name
            self.write(rel, data, rec["ts"] + 3600)
            return rel

        s = picks[0]
        entries.append({"path": copy_of(s, f"{s['stem']}-{HOST}.md", False), "original": s["path"], "pattern": "onedrive", "identical": False})
        s = picks[1]
        entries.append({"path": copy_of(s, f"{s['stem']} (1).md", False), "original": s["path"], "pattern": "numbered", "identical": False})
        s = picks[2]
        entries.append({"path": copy_of(s, f"{s['stem']} ({HOST}'s conflicted copy 2026-08-30).md", False), "original": s["path"], "pattern": "dropbox", "identical": False})
        s = picks[3]
        entries.append({"path": copy_of(s, f"{s['stem']}-{HOST}.md", True), "original": s["path"], "pattern": "onedrive", "identical": True})
        # a non-Markdown conflict copy
        self.write("notes.txt", "Plain text notes.\n", self.ts())
        self.write(f"notes-{HOST}.txt", "Plain text notes.\nSecond device.\n", self.ts())
        entries.append({"path": f"notes-{HOST}.txt", "original": "notes.txt", "pattern": "onedrive", "identical": False})
        m["conflictCopies"] = entries
        # looks like a conflict copy, has no original: must be treated as a note
        self.write(f"Solo-{HOST}.md", "# Solo\n\nKein Original vorhanden.\n", self.ts())
        m["notAConflictCopy"] = [f"Solo-{HOST}.md"]

    def write_boards(self):
        m = self.manifest
        regular = [n for n in self.notes if n["kind"] == "regular"]
        nfd_note = next(n for n in self.notes if n["kind"] == "unicode" and unicodedata.normalize("NFC", n["path"]) != n["path"])
        boards = []

        def card(ts, title, column, order, notes, extra=None, created_delta=7 * 86400):
            ms = self.rng.randrange(0, 1000)
            c = {
                "id": ulid(ts * 1000 + ms, self.rng),
                "title": title,
                "column": column,
                "order": order,
                "notes": notes,
                "created": iso(ts - created_delta, ms),
                "updated": iso(ts, ms),
            }
            if extra:
                c.update(extra)
            return c

        # --- atlas ---------------------------------------------------------
        t0 = BASE_TS - 5 * 86400
        columns = [{"id": "todo", "name": "To Do"}, {"id": "doing", "name": "Doing"}, {"id": "done", "name": "Done"}]
        picks = self.rng.sample(regular, 5)
        orders = ["a0", "a0V", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "aA"]
        cards = [
            card(t0 + 100, "Zoom-Stufen für Offline-Bundles festlegen", "doing", orders[0], [picks[0]["path"]]),
            card(t0 + 200, "Onboarding-Notiz schreiben", "doing", orders[1], [picks[1]["path"], picks[2]["path"]]),
            card(t0 + 300, "Spaltennamen abstimmen", "todo", orders[2], []),
            card(t0 + 400, "Release-Checkliste prüfen", "todo", orders[3], [picks[3]["path"]]),
            card(t0 + 500, "Demo-Vault aufräumen", "done", orders[4], []),
            card(t0 + 600, "Konfliktkopien-Regex erweitern", "done", orders[5], [picks[4]["path"]]),
            card(t0 + 700, "Verweis auf fehlende Notiz", "todo", orders[6], ["projects/Nicht Vorhanden.md"]),
            card(t0 + 800, "Verweis auf NFD-Notiz in NFC-Form", "todo", orders[7], [unicodedata.normalize("NFC", nfd_note["path"])]),
            card(t0 + 900, "Karte in fehlender Spalte", "review", orders[8], []),
            card(t0 + 1000, "Gelöschte Karte (Tombstone)", "done", orders[9], [], {"deleted": iso(t0 + 2000)}),
            card(t0 + 1100, "Karte mit unbekanntem Schlüssel", "doing", orders[10], [], {"color": "amber"}),
            card(t0 + 1200, "Letzte Karte", "todo", orders[11], []),
        ]
        board = {"format": 1, "name": "Atlas", "columns": columns, "updated": iso(t0 + 1300)}
        self.write("boards/atlas/board.json", dump_json(board), t0 + 1300)
        for c in cards:
            self.write(f"boards/atlas/cards/{c['id']}.json", dump_json(c), t0 + 1300)
        # conflict sibling (same id, newer updated -> sibling wins LWW)
        sib = dict(cards[0])
        sib["title"] = cards[0]["title"] + " (vom zweiten Gerät)"
        sib["updated"] = iso(t0 + 100 + 3600, 0)
        self.write(f"boards/atlas/cards/{sib['id']}-{HOST}.json", dump_json(sib), t0 + 5000)
        # identical-bytes sibling
        self.write(f"boards/atlas/cards/{cards[2]['id']} (1).json", dump_json(cards[2]), t0 + 5000)
        boards.append({
            "slug": "atlas",
            "path": "boards/atlas",
            "columns": [c["id"] for c in columns],
            "cards": [c["id"] for c in cards],
            "conflictSiblings": [{"path": f"boards/atlas/cards/{sib['id']}-{HOST}.json", "id": sib["id"], "expectedWinner": "sibling"}],
            "identicalSiblings": [{"path": f"boards/atlas/cards/{cards[2]['id']} (1).json", "id": cards[2]["id"]}],
            "tombstones": [cards[9]["id"]],
            "orphanColumnCards": [cards[8]["id"]],
            "unknownKeyCards": [cards[10]["id"]],
            "danglingNoteLinks": [{"card": cards[6]["id"], "note": "projects/Nicht Vorhanden.md"}],
            "nfcLinkToNfdNote": {"card": cards[7]["id"], "note": unicodedata.normalize("NFC", nfd_note["path"]), "file": nfd_note["path"]},
            "notesInsideBoardFolder": ["boards/atlas/Retro.md"],
        })
        # --- harbor --------------------------------------------------------
        t1 = BASE_TS - 12 * 86400
        columns = [{"id": "backlog", "name": "Backlog"}, {"id": "done", "name": "Fertig"}]
        picks = self.rng.sample(regular, 2)
        cards = [
            card(t1 + 10, "Plugin-API einfrieren", "backlog", "a0", [picks[0]["path"]]),
            card(t1 + 20, "Performance-Budget messen", "backlog", "a1", [picks[1]["path"]]),
            card(t1 + 30, "Docs-Plan abschließen", "done", "a2", []),
        ]
        board = {"format": 1, "name": "Harbor", "columns": columns, "updated": iso(t1 + 40)}
        self.write("boards/harbor/board.json", dump_json(board), t1 + 40)
        for c in cards:
            self.write(f"boards/harbor/cards/{c['id']}.json", dump_json(c), t1 + 40)
        boards.append({"slug": "harbor", "path": "boards/harbor", "columns": [c["id"] for c in columns], "cards": [c["id"] for c in cards]})
        # --- not a board: cards/ without board.json --------------------------
        stray = card(t1 + 50, "Streunende Karte", "todo", "a0", [])
        self.write(f"boards/not-a-board/cards/{stray['id']}.json", dump_json(stray), t1 + 50)
        m["boards"] = boards
        m["notABoard"] = ["boards/not-a-board"]

    def write_misc(self):
        m = self.manifest
        other = {
            "projects/config.json": '{\n  "name": "atlas",\n  "zoomLevels": [3, 9, 15]\n}\n',
            "projects/script.py": "import sys\n\nprint(sys.argv[1:])\n",
            "projects/main.rs": "fn main() {\n    println!(\"novalis\");\n}\n",
            "README": "Plain file without extension.\n",
            "data.csv": "id,name\n1,Atlas\n2,Harbor\n",
            "projects/atlas/spec.yaml": "format: 1\nzoom:\n  - 3\n  - 9\n",
        }
        for rel, text in other.items():
            self.write(rel, text, self.ts())
        m["otherFiles"] = sorted(other)
        m["nonUtf8"] = ["archive/legacy-latin1.md"]
        self.write("archive/legacy-latin1.md", "# Grüße\n\nAus der alten Welt.\n".encode("latin-1"), self.ts())
        ignored = ["archive/.hidden.md", "archive/~Entwurf.md", "archive/Entwurf.tmp"]
        for rel in ignored:
            self.write(rel, "ignored by the watcher\n", self.ts())
        m["ignoredByWatcher"] = ignored
        if not self.args.no_marker:
            self.write(".novalis/vault.json", '{"format": 1}\n', BASE_TS)
        if self.args.legacy_config:
            legacy = {
                "prefsVersion": 1,
                "taskView": {
                    "defaultMode": "list",
                    "kanbanColumns": [
                        {"id": "backlog", "title": "Backlog"},
                        {"id": "todo", "title": "To Do"},
                        {"id": "in-progress", "title": "In Progress"},
                        {"id": "review", "title": "Review"},
                        {"id": "done", "title": "Done"},
                    ],
                },
                "features": {"tasks": True, "calendar": True},
            }
            self.write(".novalis/config.json", json.dumps(legacy, indent=2) + "\n", BASE_TS)
        m["vaultMarker"] = None if self.args.no_marker else ".novalis/vault.json"
        m["legacyConfig"] = ".novalis/config.json" if self.args.legacy_config else None
        stand_ins = []
        if not self.args.no_cloud_stand_ins:
            for i in range(3):
                rel = f"cloud-only/Nur Online {i}.md"
                p = self.abs_path(rel)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb"):
                    pass
                os.truncate(p, 4096)
                os.utime(p, (BASE_TS, BASE_TS))
                st = os.stat(p)
                if st.st_blocks != 0:
                    print(f"warning: {rel} is not sparse on this volume (st_blocks={st.st_blocks}); the size>0 && blocks==0 heuristic will not fire", file=sys.stderr)
                stand_ins.append({"path": rel, "bytes": 4096, "note": "sparse file: size > 0 and no allocated blocks on volumes with sparse support; reads return zeros, never EDEADLK"})
        m["cloudStandIns"] = stand_ins

    def finish(self):
        m = self.manifest
        files = 0
        folders = 0
        total = 0
        md = 0
        for dirpath, dirnames, filenames in os.walk(self.root):
            folders += len(dirnames)
            for fn in filenames:
                files += 1
                total += os.path.getsize(os.path.join(dirpath, fn))
                if fn.endswith(".md"):
                    md += 1
        m["counts"].update({"filesTotal": files, "foldersTotal": folders, "bytesTotal": total, "mdFilesTotal": md})
        tss = [n["ts"] for n in self.notes]
        m["mtimeRange"] = [iso(min(tss)), iso(max(tss))]
        expected_md = len(self.notes) + sum(1 for c in m["conflictCopies"] if c["path"].endswith(".md")) + len(m["notAConflictCopy"]) + len(m["nonUtf8"]) + len(m["cloudStandIns"]) + sum(1 for x in m["ignoredByWatcher"] if x.endswith(".md"))
        if md != expected_md:
            raise SystemExit(f"internal check failed: {md} .md files on disk, expected {expected_md}")
        self.write("manifest.json", json.dumps(m, indent=2, sort_keys=True, ensure_ascii=True) + "\n", BASE_TS)
        return m


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate a synthetic novalis vault (deterministic).")
    ap.add_argument("target", help="directory to create (must not exist or must be empty, or use --force on a previous run's output)")
    ap.add_argument("--count", "--size", dest="count", type=int, default=10000, help="total number of .md notes incl. special ones (default 10000; --size is an alias)")
    ap.add_argument("--seed", type=int, default=20260905)
    ap.add_argument("--large", type=int, default=3, help="number of ~2 MB notes (default 3)")
    ap.add_argument("--depth", type=int, default=8, help="depth of the deep folder chain (default 8)")
    ap.add_argument("--legacy-config", action="store_true", help="also write an old-style .novalis/config.json for migrate tests")
    ap.add_argument("--no-marker", action="store_true", help="do not write .novalis/vault.json")
    ap.add_argument("--no-cloud-stand-ins", action="store_true", help="skip the sparse cloud-only stand-in files")
    ap.add_argument("--force", action="store_true", help="wipe the target first if it holds a manifest.json from this generator")
    args = ap.parse_args(argv)
    if args.count < 60:
        ap.error("--count must be at least 60 (the special notes alone are about 30)")
    if args.large < 0 or args.depth < 1:
        ap.error("--large must be >= 0 and --depth >= 1")
    root = os.path.abspath(args.target)
    if os.path.exists(root) and os.listdir(root):
        manifest = os.path.join(root, "manifest.json")
        ok = False
        if os.path.isfile(manifest):
            try:
                ok = json.load(open(manifest, encoding="utf-8")).get("generator") == GENERATOR
            except (OSError, ValueError):
                ok = False
        if not (args.force and ok):
            print(f"refusing to write into non-empty {root} (use --force on a directory this generator created)", file=sys.stderr)
            return 2
        shutil.rmtree(root)
    os.makedirs(root, exist_ok=True)
    rng = random.Random(args.seed)
    v = Vault(root, rng, args)
    v.plan_specials()
    regular = args.count - len(v.notes)
    v.plan_regular(regular)
    v.write_notes()
    v.write_conflict_copies()
    v.write_boards()
    v.write_misc()
    m = v.finish()
    c = m["counts"]
    print(f"{root}: {c['notesTotal']} notes ({c['notesRegular']} regular), {c['filesTotal']} files, {c['foldersTotal']} folders, {c['bytesTotal'] / 1e6:.1f} MB, {c['linksTotal']} links ({c['linksUnresolved']} unresolved), {len(m['boards'])} boards; manifest.json written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
