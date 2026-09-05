#!/usr/bin/env python3
"""novalis UI/UX variant mockups.

`python3 gen.py skeletons`  -> writes skeleton HTML frames (one DOM, no style), base.css, per-style spec files
`python3 gen.py build`      -> assembles index.html from css/<slug>.css files into one comparison page

The DOM is identical for every style (the catalog's rule: same content, only design varies). Style CSS is scoped
to `.style-<slug>`; light/dark are two token sets selected by `[data-theme]` on the frame root.
"""
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
CATALOG = Path('/Users/sgrundhoefer/Projects/designSprache/styles')
DESIGN_REPORT = Path('/Users/sgrundhoefer/Projects/novalisNeo/docs/research/2026-09-05-design.md')

STYLES = [
    # slug, display name, leading (gets the layout alternates), catalog mode
    ('swiss', 'Swiss', True, 'light'),
    ('editorial-print', 'Editorial-Print', False, 'light'),
    ('dev-noir', 'Dev-Noir', False, 'dark'),
    ('warm-editorial', 'Warm Editorial', False, 'light'),
    ('flat', 'Flat 2.0 (Kontrollreihe)', False, 'both'),
]

# ---------------------------------------------------------------- reference content (German, identical everywhere)

TREE = [
    ('folder', 'calendar', '5', False),
    ('folder', 'journal', '8', False),
    ('folder', 'meetings', '3', False),
    ('folder', 'projects', '7', False),
    ('folder', 'reading', '12', False),
    ('folder-open', 'research', '16', True),
    ('file', 'Conflict Resolution Patterns', 'Di.', None),
    ('file', 'Data Ownership', '28.08.', None),
    ('file', 'Digital Gardens', '22.08.', None),
    ('file', 'Local-First Software', 'gestern', None),
    ('file-active', 'Offline-First UX', 'heute', None),
    ('file-cloud', 'Sync Strategies Compared', 'nur online', None),
    ('file-conflict', 'Zettelkasten and PARA', 'Konfliktkopie', None),
    ('board', 'Atlas', 'Board', None),
]

NOTE_LINES = [
    # (kind, html) — kind is the CSS class on .line; html uses span token classes
    ('fm', '<span class="marker">---</span>'),
    ('fm', '<span class="fm-key">title:</span> Offline-First UX'),
    ('fm', '<span class="fm-key">tags:</span> [pkm, ux]'),
    ('fm', '<span class="marker">---</span>'),
    ('h1', '<span class="marker"># </span>Offline-First UX'),
    ('blank', ''),
    ('p', 'Was eine App beim ersten Start ohne Netz zeigt, entscheidet, ob man ihr traut. Ein leerer Bildschirm ist eine Zusage, die nicht eingehalten wurde.'),
    ('blank', ''),
    ('h2', '<span class="marker">## </span>Was der erste Start enthalten sollte'),
    ('blank', ''),
    ('li', '<span class="marker">- </span>Eine Startnotiz, die erklärt, wo die Dateien liegen'),
    ('li', '<span class="marker">- </span>Ein Beispielboard mit <span class="strong"><span class="marker">**</span>drei Spalten<span class="marker">**</span></span>'),
    ('li', '<span class="marker">- </span>Keine Anmeldung, keine Synchronisierung, kein Warten'),
    ('blank', ''),
    ('quote', '<span class="marker">&gt; </span>Lokal zuerst heißt: Die Datei ist die Wahrheit, der Server ein Gast.'),
    ('blank', ''),
    ('p', 'Siehe <span class="link"><span class="marker">[[</span>Local-First Software<span class="marker">]]</span></span> und die Entscheidung im <span class="link"><span class="marker">[[</span>Atlas Decisions Log<span class="marker">]]</span></span>.'),
    ('blank', ''),
    ('fence', '<span class="marker">```</span><span class="lang">json</span>'),
    ('code', '{ "id": "01K4G9Z2Q7M3N8RSTV5WXY6ZAB", "column": "doing" }'),
    ('fence', '<span class="marker">```</span>'),
    ('blank', ''),
    ('task', '<span class="marker">- </span><span class="checkbox open">[ ]</span> Onboarding-Notiz für das Demo-Vault schreiben'),
    ('task done', '<span class="marker">- </span><span class="checkbox done">[x]</span> Spaltennamen mit dem Team abstimmen'),
    ('blank', ''),
    ('p', '<span class="tag">#pkm</span> <span class="tag">#ux</span>'),
]

TABS = [('Offline-First UX', 'active'), ('Atlas Overview', ''), ('2026-08-05', '')]

STATUS = ['214 Wörter', 'Z 12, Sp 4', 'UTF-8', 'OneDrive · 2 nur online']

BOARD = {
    'name': 'Atlas',
    'columns': [
        ('Ideen', [
            ('Kartenfarben nach Projekt', None, 'vor 3 Tagen', ''),
            ('Wochenrückblick als Vorlage', None, 'gestern', ''),
        ]),
        ('In Arbeit', [
            ('Zoom-Stufen für Offline-Bundles festlegen', 'Atlas Rendering Spec', 'vor 2 Std.', 'selected'),
            ('Onboarding-Notiz schreiben', 'Offline-First UX', 'heute', ''),
            ('Spaltennamen abstimmen', None, 'gestern', ''),
        ]),
        ('Warten', [
            ('Release-Checkliste prüfen', None, 'Mo.', ''),
            ('Rückmeldung von Jonas', None, 'Di.', ''),
        ]),
        ('Fertig', [
            ('Demo-Vault aufräumen', None, '28.08.', ''),
            ('Konfliktkopien-Regex erweitern', None, '22.08.', ''),
        ]),
    ],
}

PALETTE_QUERY = 'off'
PALETTE_RESULTS = [
    ('note', 'Offline-First UX', 'research'),
    ('note', 'Offline-First Bundles', 'projects / Atlas Rendering Spec'),
    ('note', 'Data Ownership', 'research'),
    ('command', 'Board umschalten', '⌘⇧B'),
    ('command', 'Nur-Online-Notizen anzeigen', ''),
]

# ---------------------------------------------------------------- DOM


def titlebar(title):
    return f'''<div class="titlebar">
  <div class="lights"><span class="l-close"></span><span class="l-min"></span><span class="l-zoom"></span></div>
  <div class="crumb"><span class="crumb-seg">Notizen</span><span class="crumb-sep">/</span><span class="crumb-seg">research</span><span class="crumb-sep">/</span><span class="crumb-seg current">Offline-First UX.md</span></div>
  <div class="title">{html.escape(title)}</div>
  <div class="titlebar-right"><span class="kbd">⌘K</span></div>
</div>'''


def sidebar():
    items = []
    for kind, name, meta, open_ in TREE:
        cls = {'folder': 'folder', 'folder-open': 'folder open', 'file': 'file', 'file-active': 'file active',
               'file-cloud': 'file cloud', 'file-conflict': 'file conflict', 'board': 'board-item'}[kind]
        depth = 'depth-1' if kind.startswith('file') else 'depth-0'
        badge = ''
        if kind == 'file-cloud':
            badge = '<span class="badge badge-cloud" title="nur online">☁</span>'
        if kind == 'file-conflict':
            badge = '<span class="badge badge-conflict" title="Konfliktkopie">⚠</span>'
        chev = '<span class="chev"></span>' if kind.startswith('folder') else '<span class="chev none"></span>'
        marker = '<span class="active-marker"></span>'
        items.append(f'<li class="{cls} {depth}">{marker}{chev}<span class="name">{html.escape(name)}</span>{badge}<span class="meta">{html.escape(meta)}</span></li>')
    return f'''<aside class="sidebar">
  <div class="sidebar-head"><span class="vault-name">Notizen</span><span class="legend"><span>Name</span><span>Geändert</span></span></div>
  <ul class="tree">
    {chr(10).join(items)}
  </ul>
  <div class="sidebar-foot"><span class="hint"><span class="hint-dot"></span>2 Notizen nur online · 1 Konfliktkopie</span></div>
</aside>'''


def tabs():
    t = ''.join(f'<div class="tab {a}"><span class="tab-name">{html.escape(n)}</span><span class="tab-close">×</span></div>' for n, a in TABS)
    return f'<div class="tabs">{t}<div class="tab-spacer"></div></div>'


def editor():
    lines = []
    for i, (kind, content) in enumerate(NOTE_LINES, 1):
        cur = ' cursor' if i == 12 else ''
        lines.append(f'<div class="line {kind}{cur}"><span class="ln">{i}</span><span class="txt">{content}</span></div>')
    return f'<div class="editor"><div class="doc">{chr(10).join(lines)}</div></div>'


def statusbar():
    return '<div class="statusbar">' + ''.join(f'<span class="status-item{" sync" if i == 3 else ""}">{"<span class=\"status-dot\"></span>" if i == 3 else ""}{html.escape(s)}</span>' for i, s in enumerate(STATUS)) + '</div>'


def board():
    cols = []
    for ci, (cname, cards) in enumerate(BOARD['columns'], 1):
        cs = []
        for title, note, when, sel in cards:
            link = f'<div class="card-note"><span class="card-note-glyph"></span><span class="card-note-name">{html.escape(note)}</span></div>' if note else ''
            state = 'done' if cname == 'Fertig' else ('doing' if cname == 'In Arbeit' else ('waiting' if cname == 'Warten' else 'idea'))
            cs.append(f'''<div class="card {sel} state-{state}">
        <div class="card-title">{html.escape(title)}</div>
        {link}
        <div class="card-meta"><span class="card-state"><span class="state-mark"></span><span class="state-word">{cname}</span></span><span class="card-when">{html.escape(when)}</span></div>
      </div>''')
        cols.append(f'''<div class="column col-{ci}">
      <div class="col-head"><span class="col-num">{["I", "II", "III", "IV"][ci - 1]}</span><span class="col-name">{html.escape(cname)}</span><span class="col-count">{len(cards)}</span></div>
      <div class="cards">
        {chr(10).join(cs)}
      </div>
    </div>''')
    return f'''<div class="board">
  <div class="board-head"><span class="board-name">{BOARD["name"]}</span><span class="board-sub">4 Spalten · 9 Karten</span><span class="board-actions"><span class="btn ghost">Spalte hinzufügen</span><span class="btn primary">Neue Karte</span></span></div>
  <div class="columns">
    {chr(10).join(cols)}
  </div>
</div>'''


def palette():
    rows = ''.join(
        f'<li class="result {k}{" active" if i == 0 else ""}"><span class="result-glyph"></span><span class="result-name">{html.escape(n)}</span><span class="result-meta">{html.escape(m)}</span></li>'
        for i, (k, n, m) in enumerate(PALETTE_RESULTS))
    return f'''<div class="scrim"></div>
<div class="palette">
  <div class="palette-input"><span class="palette-prompt">›</span><span class="palette-text">{PALETTE_QUERY}</span><span class="caret"></span><span class="kbd">esc</span></div>
  <ul class="results">{rows}</ul>
  <div class="palette-foot"><span><span class="kbd">↵</span> öffnen</span><span><span class="kbd">⌘↵</span> in neuem Tab</span><span><span class="kbd">⇧⌘P</span> Befehle</span></div>
</div>'''


def frame(slug, screen, layout, theme):
    """screen: s1 (files+editor) | s2 (board); layout: l2 (tabs, default) | l1 (no tabs) | l3 (palette-only) | l4 (board pane) | l5 (board+note split)."""
    title = 'Offline-First UX — novalis' if screen == 's1' else 'Atlas — novalis'
    parts = [f'<div class="frame style-{slug} screen-{screen} layout-{layout}" data-theme="{theme}">', '<div class="win">', titlebar(title), '<div class="body">']
    if layout != 'l3':
        parts.append(sidebar())
    parts.append('<main class="main">')
    if screen == 's1':
        if layout in ('l2', 'l3'):
            parts.append(tabs())
        parts.append(editor())
        parts.append(statusbar())
    elif screen == 's2' and layout == 'l5':
        parts.append('<div class="split">')
        parts.append(f'<div class="split-board">{board()}</div>')
        parts.append(f'<div class="split-note">{tabs()}{editor()}{statusbar()}</div>')
        parts.append('</div>')
    else:
        parts.append(tabs())
        parts.append(board())
        parts.append(statusbar())
    parts.append('</main>')
    parts.append('</div>')  # body
    parts.append('</div>')  # win
    if layout == 'l3':
        parts.append(palette())
    parts.append('</div>')
    return '\n'.join(parts)


BASE_CSS = r"""
/* structural base shared by every frame; styles override freely (scoped to .style-<slug>) */
.frame{width:1280px;height:800px;overflow:hidden;position:relative;font-size:14px;line-height:1.5;font-family:system-ui,sans-serif}
.frame *{box-sizing:border-box;margin:0;padding:0}
.frame ul{list-style:none}
.frame .win{display:flex;flex-direction:column;width:100%;height:100%}
.frame .titlebar{display:flex;align-items:center;gap:12px;height:38px;flex:0 0 auto;padding:0 12px}
.frame .lights{display:flex;gap:8px}
.frame .lights span{width:12px;height:12px;border-radius:50%;display:block}
.frame .crumb{display:none;align-items:center;gap:6px}
.frame .title{flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frame .titlebar-right{display:flex;gap:8px;align-items:center}
.frame .body{display:flex;flex:1;min-height:0}
.frame .sidebar{width:240px;flex:0 0 240px;display:flex;flex-direction:column;min-height:0}
.frame .sidebar-head{display:flex;flex-direction:column;gap:4px;flex:0 0 auto}
.frame .legend{display:flex;justify-content:space-between}
.frame .tree{flex:1;overflow:hidden}
.frame .tree li{display:flex;align-items:center;gap:6px;white-space:nowrap}
.frame .tree .name{flex:1;overflow:hidden;text-overflow:ellipsis}
.frame .tree .depth-1{padding-left:16px}
.frame .chev{width:10px;height:10px;display:inline-block;flex:0 0 auto}
.frame .active-marker{display:none}
.frame .sidebar-foot{flex:0 0 auto}
.frame .main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative}
.frame .tabs{display:flex;flex:0 0 auto;align-items:stretch}
.frame .tab{display:flex;align-items:center;gap:8px;white-space:nowrap}
.frame .tab-spacer{flex:1}
.frame .editor{flex:1;overflow:hidden;min-height:0}
.frame .line{display:flex;align-items:baseline}
.frame .ln{display:none;width:32px;flex:0 0 32px;text-align:right}
.frame .txt{flex:1;white-space:pre-wrap;word-wrap:break-word;min-width:0}
.frame .statusbar{display:flex;gap:16px;flex:0 0 auto;align-items:center}
.frame .status-item.sync{margin-left:auto;display:flex;align-items:center;gap:6px}
.frame .board{flex:1;display:flex;flex-direction:column;min-height:0}
.frame .board-head{display:flex;align-items:baseline;gap:12px;flex:0 0 auto}
.frame .board-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.frame .columns{display:flex;flex:1;gap:16px;min-height:0}
.frame .column{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.frame .col-head{display:flex;align-items:baseline;gap:8px;flex:0 0 auto}
.frame .col-count{margin-left:auto}
.frame .cards{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
.frame .card-meta{display:flex;justify-content:space-between;align-items:center;gap:8px}
.frame .card-state{display:flex;align-items:center;gap:6px}
.frame .card-note{display:flex;align-items:center;gap:6px}
.frame .split{display:flex;flex:1;min-height:0}
.frame .split-board{flex:1.2;display:flex;flex-direction:column;min-width:0;min-height:0}
.frame .split-note{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.frame .scrim{position:absolute;inset:0}
.frame .palette{position:absolute;left:50%;top:96px;transform:translateX(-50%);width:640px;display:flex;flex-direction:column}
.frame .palette-input{display:flex;align-items:center;gap:8px}
.frame .palette-text{flex:0 0 auto}
.frame .caret{flex:1;position:relative}
.frame .result{display:flex;align-items:center;gap:10px}
.frame .result-name{flex:1}
.frame .palette-foot{display:flex;gap:16px}
"""

# ---------------------------------------------------------------- prompt export (catalog's own "Als Prompt kopieren" skeleton)

P_INTRO = 'Verwende die folgende Designsprache als visuelle Grundlage für dieses Projekt. Weiche nicht davon ab, ohne es zu begründen.'
SITE = 'https://grundhofer.github.io/designsprache'


def build_prompt(d):
    out = [P_INTRO, '', f"# {d.get('name', '')}", '']
    if d.get('idea'):
        out += ['## Kernidee', d['idea'], '']
    p = d.get('params', {}) or {}
    labels = [('radius', 'Radius'), ('contrast', 'Kontrast'), ('density', 'Dichte'), ('depth', 'Tiefe'),
              ('color', 'Farbe'), ('type', 'Typografie'), ('motion', 'Motion'), ('texture', 'Textur')]
    if p:
        out.append('## Harte Parameter')
        for k, lab in labels:
            if p.get(k):
                out.append(f'- **{lab}:** {p[k]}')
        out.append('')
    if d.get('palette'):
        out += ['## Palette', '  '.join(d['palette']), '']
    if d.get('googleFonts'):
        out += ['## Schriften', ', '.join(d['googleFonts']) + ' (über Google Fonts, jeweils mit generischem Fallback)', '']
    if d.get('markers'):
        out += ['## Regeln, die einzuhalten sind'] + [f'- {m}' for m in d['markers']] + ['']
    if d.get('risks'):
        out += ['## Bekannte Fehlerquellen dieses Stils — vermeide sie'] + [f'- {r}' for r in d['risks']] + ['']
    if d.get('a11y'):
        out += ['## Barrierefreiheit', d['a11y'], '']
    if d.get('tip'):
        out += ['## Praxistipp', d['tip'], '']
    out += ['---', f"Quelle: {SITE}/de/ — {d.get('name', '')}"]
    return '\n'.join(out)


# ---------------------------------------------------------------- commands


def frames_for(slug, leading):
    fr = [('s1', 'l2', 'S1 · Dateien + Editor (Tabs, L2)'), ('s2', 'l4', 'S2 · Kanban als Pane (L4)')]
    if leading:
        fr += [('s1', 'l1', 'Alternative L1 · ohne Tabs'), ('s1', 'l3', 'Alternative L3 · nur Palette, keine Seitenleiste'),
               ('s2', 'l5', 'Alternative L5 · Board + verknüpfte Notiz geteilt')]
    return fr


def cmd_skeletons():
    out = HERE / 'skeleton'
    out.mkdir(exist_ok=True)
    (out / 'base.css').write_text(BASE_CSS, encoding='utf-8')
    for screen, layout, label in [('s1', 'l2', ''), ('s2', 'l4', ''), ('s1', 'l1', ''), ('s1', 'l3', ''), ('s2', 'l5', '')]:
        for theme in ('light', 'dark'):
            (out / f'{screen}-{layout}-{theme}.html').write_text(
                f'<!-- skeleton: same DOM for every style; replace SLUG with the style slug -->\n{frame("SLUG", screen, layout, theme)}\n', encoding='utf-8')
    # class inventory for the agents
    inv = sorted(set(re.findall(r'class="([^"]+)"', frame('SLUG', 's1', 'l3', 'light') + frame('SLUG', 's2', 'l5', 'light'))))
    classes = sorted({c for grp in inv for c in grp.split()})
    (out / 'CLASSES.txt').write_text('\n'.join(classes), encoding='utf-8')
    # per-style spec extracted from the design report + catalog JSON + prompt export
    report = DESIGN_REPORT.read_text(encoding='utf-8')
    sections = {
        'swiss': ('### F3.', '### F4.'), 'editorial-print': ('### F4.', '### F5.'),
        'dev-noir': ('### F5.', '### F6.'), 'warm-editorial': ('### F6.', '### F7.'), 'flat': ('### F9.', '## RECOMMENDATIONS'),
    }
    specs = HERE / 'specs'
    specs.mkdir(exist_ok=True)
    for slug, name, leading, mode in STYLES:
        a, b = sections[slug]
        i, j = report.find(a), report.find(b)
        spec = report[i:j] if i >= 0 and j > i else '(section not found)'
        d = json.load(open(CATALOG / f'{slug}.json', encoding='utf-8'))
        (specs / f'{slug}.md').write_text(
            f'# Spec: {name} ({slug})\n\nCatalog mode: {mode}. Demo to look at: {CATALOG}/{slug}.html · Fact sheet: {CATALOG}/{slug}.json\n\n'
            f'## From the design report\n\n{spec}\n\n## Catalog prompt export (verbatim structure)\n\n```\n{build_prompt(d)}\n```\n', encoding='utf-8')
    print(f'wrote skeletons to {out}, specs to {specs}, {len(classes)} classes')


PAGE_CSS = r"""
:root{--bg:#F4F4F3;--fg:#1B1B1B;--mute:#6B6B6B;--line:#D9D9D6;--card:#FFFFFF;--acc:#1B1B1B;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#161616;--fg:#E8E8E6;--mute:#9A9A97;--line:#2E2E2C;--card:#1E1E1D;--acc:#E8E8E6;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#161616;--fg:#E8E8E6;--mute:#9A9A97;--line:#2E2E2C;--card:#1E1E1D;--acc:#E8E8E6;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.wrap{max-width:1360px;margin:0 auto;padding:32px 24px 96px}
header.top{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px}
header.top h1{font-size:22px;font-weight:600;margin:0;letter-spacing:-.01em}
header.top p{margin:4px 0 0;color:var(--mute);max-width:70ch}
.controls{margin-left:auto;display:flex;gap:8px;align-items:center}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.seg button{font:inherit;font-size:12px;padding:5px 10px;border:0;background:transparent;color:var(--fg);cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
nav.jump{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;margin-bottom:28px}
nav.jump a{color:var(--fg);text-decoration:none;border-bottom:1px solid var(--line);padding-bottom:1px}
nav.jump a:hover{border-color:var(--fg)}
section.style{margin:0 0 56px;padding-top:24px;border-top:1px solid var(--line)}
section.style h2{font-size:18px;font-weight:600;margin:0 0 4px}
.facts{color:var(--mute);font-size:13px;margin:0 0 16px;max-width:90ch}
.facts b{color:var(--fg);font-weight:500}
details.prompt{margin:0 0 20px;font-size:13px}
details.prompt summary{cursor:pointer;color:var(--mute)}
details.prompt pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);padding:12px 14px;font:12px/1.5 ui-monospace,Menlo,monospace;max-height:320px;overflow:auto;margin:8px 0 0}
.frames{display:grid;gap:28px}
.framebox{background:var(--card);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.framebar{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:12px;color:var(--mute)}
.framebar b{color:var(--fg);font-weight:500}
.framebar .seg{margin-left:auto}
.stage{width:100%;position:relative;overflow:hidden;background:var(--line)}
.stage .frame{position:absolute;left:0;top:0;transform-origin:0 0}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
"""

PAGE_JS = r"""
(function(){
  var root=document.documentElement;
  function fit(){
    document.querySelectorAll('.stage').forEach(function(st){
      var w=st.clientWidth, s=w/1280; st.style.height=(800*s)+'px';
      var f=st.querySelector('.frame'); if(f){f.style.transform='scale('+s+')';}
    });
  }
  window.addEventListener('resize',fit); fit();
  // per-frame theme
  document.querySelectorAll('.framebar .seg[data-for]').forEach(function(seg){
    seg.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click',function(){
        var fr=document.getElementById(seg.dataset.for);
        fr.setAttribute('data-theme',b.dataset.theme);
        seg.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
      });
    });
  });
  // global frame theme
  document.querySelectorAll('.controls .seg[data-global] button').forEach(function(b){
    b.addEventListener('click',function(){
      var t=b.dataset.theme;
      document.querySelectorAll('.frame').forEach(function(fr){fr.setAttribute('data-theme',t)});
      document.querySelectorAll('.framebar .seg[data-for] button').forEach(function(x){x.setAttribute('aria-pressed',String(x.dataset.theme===t))});
      document.querySelectorAll('.controls .seg[data-global] button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
    });
  });
  // page chrome theme
  document.querySelectorAll('.controls .seg[data-page] button').forEach(function(b){
    b.addEventListener('click',function(){
      var t=b.dataset.theme; if(t==='system'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',t)}
      document.querySelectorAll('.controls .seg[data-page] button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
    });
  });
})();
"""


def cmd_build():
    css_dir = HERE / 'css'
    base = (HERE / 'skeleton' / 'base.css').read_text(encoding='utf-8')
    style_css = []
    sections = []
    jump = []
    for slug, name, leading, mode in STYLES:
        p = css_dir / f'{slug}.css'
        if not p.exists():
            print(f'missing {p}, skipping {slug}')
            continue
        style_css.append(f'/* ===== {slug} ===== */\n' + p.read_text(encoding='utf-8'))
        d = json.load(open(CATALOG / f'{slug}.json', encoding='utf-8'))
        params = d.get('params', {}) or {}
        facts = (f"<b>Kernidee:</b> {html.escape(d.get('idea', ''))} · <b>Radius:</b> {html.escape(params.get('radius', ''))} · "
                 f"<b>Farbe:</b> {html.escape(params.get('color', ''))} · <b>Schriften:</b> {html.escape(', '.join(d.get('googleFonts', [])))} · "
                 f"<b>Katalog-Modus:</b> {mode}; die zweite Farbwelt ist abgeleitet, nicht Katalogdaten.")
        boxes = []
        for screen, layout, label in frames_for(slug, leading):
            fid = f'f-{slug}-{screen}-{layout}'
            default_theme = 'dark' if mode == 'dark' else 'light'
            fr = frame(slug, screen, layout, default_theme).replace('class="frame ', f'id="{fid}" class="frame ', 1)
            boxes.append(f'''<div class="framebox">
  <div class="framebar"><b>{html.escape(name)}</b><span>{html.escape(label)}</span>
    <div class="seg" data-for="{fid}" role="group" aria-label="Farbwelt">
      <button type="button" data-theme="light" aria-pressed="{str(default_theme == 'light').lower()}">Hell</button>
      <button type="button" data-theme="dark" aria-pressed="{str(default_theme == 'dark').lower()}">Dunkel</button>
    </div></div>
  <div class="stage">{fr}</div>
</div>''')
        jump.append(f'<a href="#s-{slug}">{html.escape(name)}</a>')
        sections.append(f'''<section class="style" id="s-{slug}">
  <h2>{html.escape(name)}</h2>
  <p class="facts">{facts}</p>
  <details class="prompt"><summary>Als Prompt kopieren — der Export des Katalogs für diesen Stil</summary><pre>{html.escape(build_prompt(d))}</pre></details>
  <div class="frames">
    {chr(10).join(boxes)}
  </div>
</section>''')
    page = f'''<title>novalis Varianten</title>
<meta name="description" content="UI/UX-Varianten für novalis: vier Stilrichtungen aus dem Stil-Katalog, gleicher Inhalt, hell und dunkel, plus drei Layout-Alternativen.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@400;500&family=Work+Sans:wght@400;500;600&display=swap">
<style>{PAGE_CSS}</style>
<style>{base}</style>
<style>
{chr(10).join(style_css)}
</style>
<div class="wrap">
<header class="top">
  <div>
    <h1>novalis — UI/UX-Varianten</h1>
    <p>Derselbe Inhalt in vier Stilrichtungen aus dem Stil-Katalog (plus Flat 2.0 als Kontrollreihe): links die Notiz <i>Offline-First UX</i> im dekorierten Quelltextmodus, dann das Board <i>Atlas</i> als Pane. Jede Bildfläche ist ein 1280×800-Fenster, verkleinert. Hell/Dunkel je Bild oder für alle. Die Layout-Alternativen L1, L3 und L5 sind einmal im Stil Swiss gezeigt.</p>
  </div>
  <div class="controls">
    <div class="seg" data-global role="group" aria-label="Alle Bilder"><button type="button" data-theme="light" aria-pressed="false">Alle hell</button><button type="button" data-theme="dark" aria-pressed="false">Alle dunkel</button></div>
    <div class="seg" data-page role="group" aria-label="Seite"><button type="button" data-theme="system" aria-pressed="true">Seite: Auto</button><button type="button" data-theme="light" aria-pressed="false">Hell</button><button type="button" data-theme="dark" aria-pressed="false">Dunkel</button></div>
  </div>
</header>
<nav class="jump">{' '.join(jump)}</nav>
{chr(10).join(sections)}
</div>
<script>{PAGE_JS}</script>
'''
    (HERE / 'index.html').write_text(page, encoding='utf-8')
    print(f'wrote {HERE / "index.html"} ({len(page)} bytes), {len(sections)} styles')


if __name__ == '__main__':
    {'skeletons': cmd_skeletons, 'build': cmd_build}[sys.argv[1]]()
