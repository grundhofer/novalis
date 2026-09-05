# Spec: Swiss (swiss)

Catalog mode: light. Demo to look at: /Users/sgrundhoefer/Projects/designSprache/styles/swiss.html · Fact sheet: /Users/sgrundhoefer/Projects/designSprache/styles/swiss.json

## From the design report

### F3. SPEC 1 — Swiss / International Typographic Style (slug: swiss) — recommended #1 direction  [verified]
DEMO TO LOOK AT: styles/swiss.html (light only). Family Modernistische Schulen. Scores longevity 5 / recognition 3 / effort 3 / density 4. Finder: mode light, a11y 4, platform web 5 mobile 4 desktop 5, fits data/content/internal/dev-tool, tone precise/calm/austere. Signature: 'Eine leere Randspalte, die leer bleibt, und genau eine Signalfarbe auf unter fünf Prozent der Fläche.'

CORE IDEA (verbatim): Ein modulares Raster trägt die gesamte Hierarchie; Ordnung entsteht aus Position, Größe und Weißraum statt aus Dekoration.

EIGHT HARD PARAMETERS (verbatim): Radius 0px. Kontrast sehr hoch. Dichte luftig (score 4 = dense in practice; the demo packs a lot per screen). Tiefe: keine; Trennung ausschließlich über 1px-Linien, Abstand und Fluchtlinien. Farbe: Schwarz und Weiß als System, eine einzige Signalfarbe (Rot) rein funktional für Status, Marke und Fokus. Typografie: Neutrale Grotesk, streng hierarchisch über Größe und Gewicht, negatives Tracking in Headlines, Versalien nur in Mikrotypografie. Motion: Minimal und funktional: 100-150ms linear oder ease-out, nur Farbwechsel und Position, niemals Scale oder Bounce. Textur: keine.

GRID/SPACING: 12 columns + 24px baseline grid; edges flush to column axis; outer margins >= 40px; block spacing in multiples of 24px; asymmetric axis: content left-aligned with a deliberately EMPTY margin column (right or left) that stays empty (tip: ~25% of the surface unused); ragged-left only, never centered, never justified. Demo tokens: --base 24px, --pad clamp(20px,4.6vw,56px), body 15px / line-height 1.35, heavy rule 3px ink, hairline 1px #D4D4D4, list row padding 15px 0 16px (~52px rows), 12px column gap, legend row 9px/500 caps 0.2em grey.

PALETTE LIGHT (catalog, verified): paper #FFFFFF; ink #0B0B0B (19.7:1); grey #6E6E6E secondary text (5.1:1 — the classic #8C8C8C fails at 3.4:1, do not use); hairline #D4D4D4 (1.5:1, decorative only); red #E30613 (4.88:1 on white — passes AA for normal text, use for status square, focus ring, left accent bar, counter; keep < 5% of area).
PALETTE DARK (DERIVED by me — catalog has no dark swiss; halation rule from dev-noir sheet applied: never #FFF on #000): canvas #111111; ink #EDEDED (16.1:1); grey #9C9C9C (6.9:1); hairline #2C2C2C (1.35:1 decorative); surface-2 #1A1A1A for selected rows; red-text #FF4A55 (5.7:1) for text/focus; #E30613 (3.9:1 on #111) only as a filled square/bar, never as text.
SIGNAL COLOUR BUDGET: exactly ONE hue. Status is always word + form: filled 7px red square = active, 1px inset grey outline square = paused (demo). No green/amber exists in this style — Kanban states must be typographic/form-coded (see below); adding a second hue is a documented deviation.

FONTS: Inter (googleFonts; SIL OFL 1.1, verified). Demo stack: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif. Max 3 cuts: 400 / 500 / 700. Headline tracking -0.045em, line-height 0.86 for display; names 21px/500 -0.018em; micro caps 9-10px/500-700 with 0.14-0.22em tracking (never >0.2em on words users must read, never <11px for information). Tabular figures on all numbers (font-variant-numeric: tabular-nums). Catalog risk: 'Inter + 12 Spalten ist heute die halbe Startup-Welt' — alternative grotesk with character allowed (research/06-typografie.md suggests Mona Sans OFL); Helvetica Neue is on macOS but the catalog demo uses Inter.

SHADOW POLICY: none, anywhere (no elevation, no glow). BORDER/HAIRLINE POLICY: 1px #D4D4D4 hairlines between rows; 1px ink for strong rules (list top/bottom), 3px ink heavy rule under the masthead; inputs are underline-only (border-bottom 1px ink + border-left 2px red), radius 0; buttons 44px tall, 1px ink border, 11px/700 caps 0.14em, primary = ink fill (hover -> red fill), secondary = transparent (hover -> ink fill); hairlines must be >= 1 device pixel (they get scaled away otherwise). DENSITY: UI 13-15px, list rows 48-52px in demo; for the file tree I propose 1 baseline (24px) rows at 13px (my proposal, not in catalog). MOTION: 100-150ms linear/ease-out, colour and position only; demo uses 110ms linear; respect prefers-reduced-motion.

RULES (markers, verbatim): Radius 0px, ausnahmslos · Modulares Raster 12 Spalten + Baseline-Grid 24px, Kanten bündig zur Spaltenachse · Genau eine Signalfarbe (klassisch Rot #E30613) auf Schwarz/Weiß, Farbanteil unter 5% der Fläche · Keine Schatten, keine Verläufe, keine Texturen – Trennung über 1px-Hairlines und Abstand · Grotesk in maximal 3 Schnitten (400/500/700), Headline-Tracking -0.045em · Asymmetrische Satzachse: Inhalt linksbündig, große leere Randspalte rechts oder links · Weißraum-Budget: Außenränder >= 40px, Blockabstände in Vielfachen von 24px · Kontrast Text/Grund > 15:1 (#0B0B0B auf #FFFFFF) · Kein Zentriersatz, kein Blocksatz – alles Flattersatz linksbündig.

KNOWN FAILURE MODES (risks, verbatim): Ohne exzellente Typografie und echte Raster-Disziplin wirkt es nicht 'Swiss', sondern schlicht unfertig · Austauschbar, wenn Font und Grid Defaults bleiben · Wenig emotionale Wärme · Der Weißraum kollabiert auf Mobile zuerst · Hairlines unter 1px werden auf manchen Displays wegskaliert; die Trennung verschwindet dann komplett.

ACCESSIBILITY (sheet): 19.7:1 body; secondary grey must be >= #6E6E6E (5.1:1); micro type never under 11px, tracking over 0.2em lowers word recognition; status never red-only (always word + form); hairline dividers can vanish for low vision so structure must stand without them; focus ring 2px red, never 1px grey. TIP (verbatim): Mach das Raster einmal sichtbar, statt es nur zu befolgen: eine Hairline auf einer Spaltenachse, eine Legendenzeile über der Liste, eine leere Randspalte, die konsequent leer bleibt.

HOW NOVALIS LOOKS IN SWISS (my translation of the rules): Window: native macOS title bar (hiddenInset, traffic lights) on plain paper, no custom chrome; the whole window is one sheet with at most a 1px ink frame. File tree (left, ~240px): a typographic index — 9px caps legend row ('Name · Geändert'), 1px hairline under every entry, folders 500 weight, files 400, modified time 12px grey tabular; active file marked by a 2px red bar on the left edge (same device as the demo input's border-left) and 700 weight, no background fill; tree/editor separated by a single 1px vertical hairline sitting on a column axis. Editor: prose Inter 16-17px / line-height 1.5, measure 66-72ch, left-aligned at column 2, the right margin column stays EMPTY (this is the style's signature); h1 700 -0.045em, h2 500; markdown syntax marks in grey #6E6E6E; code in monospace (style defines none — use ui-monospace/SF Mono, flagged deviation); blockquote = 1px ink left rule; wikilinks ink with 1px red underline; @due tasks: 7px square checkbox (filled = done). Kanban: columns are NOT boxes — vertical 1px hairlines on column axes, column head = 9-10px caps 0.2em grey + count in red tabular figures; cards = rows: title 15px/500, meta 12px grey, hairline between cards, radius 0, no shadow; state = filled/hollow 7px square + word; linked note shown as an underlined title; drag = 1px ink outline, drop target = 3px ink rule. Modals / command palette: a sheet with 1px ink border, no shadow, on a white or #FFFFFFD9 scrim; buttons 44px caps; quick-open list identical to the tree rows. Status bar (optional): 9px caps grey, 6x96px red bar as the only colour (demo 'fuss').
_evidence: /Users/sgrundhoefer/Projects/designSprache/styles/swiss.json (full), styles/swiss.html (full CSS); contrast ratios computed with WCAG formula; dark palette DERIVED (ASSUMED, not in catalog)_



## Catalog prompt export (verbatim structure)

```
Verwende die folgende Designsprache als visuelle Grundlage für dieses Projekt. Weiche nicht davon ab, ohne es zu begründen.

# Swiss / International Typographic Style

## Kernidee
Ein modulares Raster trägt die gesamte Hierarchie; Ordnung entsteht aus Position, Größe und Weißraum statt aus Dekoration.

## Harte Parameter
- **Radius:** 0px
- **Kontrast:** sehr hoch
- **Dichte:** luftig
- **Tiefe:** keine; Trennung ausschließlich über 1px-Linien, Abstand und Fluchtlinien
- **Farbe:** Schwarz und Weiß als System, eine einzige Signalfarbe (Rot) rein funktional für Status, Marke und Fokus.
- **Typografie:** Neutrale Grotesk, streng hierarchisch über Größe und Gewicht, negatives Tracking in Headlines, Versalien nur in Mikrotypografie.
- **Motion:** Minimal und funktional: 100-150ms linear oder ease-out, nur Farbwechsel und Position, niemals Scale oder Bounce.
- **Textur:** keine

## Palette
#FFFFFF  #0B0B0B  #E30613  #6E6E6E  #D4D4D4

## Schriften
Inter (über Google Fonts, jeweils mit generischem Fallback)

## Regeln, die einzuhalten sind
- Radius 0px, ausnahmslos
- Modulares Raster 12 Spalten + Baseline-Grid 24px, Kanten bündig zur Spaltenachse
- Genau eine Signalfarbe (klassisch Rot #E30613) auf Schwarz/Weiß, Farbanteil unter 5% der Fläche
- Keine Schatten, keine Verläufe, keine Texturen – Trennung über 1px-Hairlines und Abstand
- Grotesk in maximal 3 Schnitten (400/500/700), Headline-Tracking -0.045em
- Asymmetrische Satzachse: Inhalt linksbündig, große leere Randspalte rechts oder links
- Weißraum-Budget: Außenränder ≥ 40px, Blockabstände in Vielfachen von 24px
- Kontrast Text/Grund > 15:1 (#0B0B0B auf #FFFFFF)
- Kein Zentriersatz, kein Blocksatz – alles Flattersatz linksbündig

## Bekannte Fehlerquellen dieses Stils — vermeide sie
- Ohne exzellente Typografie und echte Raster-Disziplin wirkt es nicht 'Swiss', sondern schlicht unfertig
- Austauschbar, wenn Font und Grid Defaults bleiben – Inter + 12 Spalten ist heute die halbe Startup-Welt
- Wenig emotionale Wärme; für Consumer-Apps mit Spaß-Anspruch zu kühl
- Der Weißraum kollabiert auf Mobile zuerst – wer dort spart, verliert genau das Merkmal
- Hairlines unter 1px werden auf manchen Displays wegskaliert; die Trennung verschwindet dann komplett

## Barrierefreiheit
Der Stil ist barrierefreiheitstechnisch der günstigste überhaupt: #0B0B0B auf Weiß liefert 19,7:1, es gibt keine Transparenz und keine Textur unter Text. Achtung beim Sekundärgrau – das klassische Hellgrau #8C8C8C erreicht auf Weiß nur 3,4:1 und fällt durch; erst ab etwa #6E6E6E (5,1:1) ist Sekundärtext konform, deshalb ist genau dieser Wert in der Demo gesetzt. Weitere reale Risiken sind zu kleine Schriftgrade in der Mikrotypografie (Legenden unter 11px, Tracking über 0.2em senkt die Worterkennung) und Statuskodierung allein über die rote Signalfarbe – jeder Status muss zusätzlich ein Wort oder eine Form tragen. Hairline-Divider als einziges Struktursignal können bei Sehschwäche verschwinden; Fokusringe daher mit 2px Rot ausführen, nicht mit 1px Grau.

## Praxistipp
Mach das Raster einmal sichtbar, statt es nur zu befolgen: eine Hairline auf einer Spaltenachse, eine Legendenzeile über der Liste, eine leere Randspalte, die konsequent leer bleibt. Der Unterschied zwischen 'Swiss' und 'weiße Seite' ist, dass der Betrachter die Konstruktion spürt – und dazu gehört der Mut, 25% der Fläche nicht zu benutzen.

---
Quelle: https://grundhofer.github.io/designsprache/de/ — Swiss / International Typographic Style
```
