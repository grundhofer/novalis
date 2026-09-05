# Spec: Editorial-Print (editorial-print)

Catalog mode: light. Demo to look at: /Users/sgrundhoefer/Projects/designSprache/styles/editorial-print.html · Fact sheet: /Users/sgrundhoefer/Projects/designSprache/styles/editorial-print.json

## From the design report

### F4. SPEC 2 — Editorial / Print-Magazin im Web (slug: editorial-print) — recommended #2 direction (light-first paper + serif)  [verified]
DEMO TO LOOK AT: styles/editorial-print.html (light only). Family Weitere Pole. Scores longevity 5 / recognition 4 / effort 3 / density 3. Finder: mode light, a11y 4, platform web 5 mobile 2 desktop 4, fits content/marketing, tone calm/formal. Signature: 'Initiale über drei Zeilen, Kapitälchen mit 0.2em Sperrung, Trennung nur durch Hairlines - null Schatten.'

CORE IDEA (verbatim): Hierarchie entsteht aus Schriftschnitt, Laufweite und Weißraum -- nicht aus Boxen, Schatten oder Farbflächen. Der Bildschirm wird als Papierseite mit Satzspiegel behandelt.

EIGHT HARD PARAMETERS (verbatim): Radius 0px, ausnahmslos. Kontrast sehr hoch. Dichte mittel bis dicht. Tiefe: keine; Ordnung über Linien, Einzüge und Spaltenkanten. Farbe: Papier-Ton plus Tinte plus genau eine gebrochene Akzentfarbe (Zeitungsrot #8C2F1F) für Initiale, Zähler und Hover. Typografie: zwei Serifen-Schnitte: Display mit hohem Strichkontrast für Titel, Lesetyp für Werksatz; Kapitälchen und Kursiv tragen die gesamte Sekundärinformation. Motion: fast keine; 120-160ms Farbwechsel auf Hover, kein Transform, kein Bounce -- Papier bewegt sich nicht. Textur: keine bis minimal: ein weicher Lichtverlauf oben (5 % Weiß) simuliert Papierschlag.

GRID/SPACING: vertical rhythm on a 24px base line — every line-height, gap and hairline a multiple of it (tip); Satzspiegel with a 70-80px margin column bordered by a vertical hairline (demo: 76px column, 18px gutter, right border 1px rule); size jump display : body > 3:1 (54px vs 16px in demo); measure ~66ch. Demo body 16px / line-height 1.55 with font-feature-settings "liga","dlig","onum","kern"; entries padding 11px 0 10px; sheet frame = 3px double rule top and bottom.

PALETTE LIGHT (catalog demo tokens, verified): paper #FBF8F1; paper-2 #F4EFE3 (hover tint); ink #17140F (17.3:1); ink-soft #4A443A (9.1:1, captions/body-secondary); muted #857C6C (3.9:1 — decorative/large only; for 10-12px small-caps labels that must be read use ink-soft, the sheet demands >= 4.5:1); rule #D6CDB9 (1.5:1); rule-strong #A99E86; red #8C2F1F (7.8:1).
PALETTE DARK (DERIVED by me — catalog has no dark editorial-print; warm hue kept because the sibling sheet warns paper tones cannot be simply inverted): paper #1B1814; paper-2 #221E19; ink #EDE6D8 (14.2:1); ink-soft #C2B9A9 (9.1:1); muted #9A9080 (5.6:1); rule #3A342B; rule-strong #5A5246 (2.3:1); red #D9705A (5.4:1).
SIGNAL BUDGET: paper + ink + ONE broken accent (brick red). Status is small caps word plus a form glyph: ■ (U+25A0) active / □ (U+25A1) paused, paused additionally italic + dotted underline (demo). No green/amber in this style; Kanban states therefore typographic (see below) — a second hue is a deviation.

FONTS: Instrument Serif (display; SIL OFL 1.1 verified; ships Regular + Italic only — build.py FONT_SPECS 'Instrument+Serif:ital,wght@0,400;1,400') and Newsreader (text; SIL OFL 1.1 verified; variable wght 200-800 + opsz 6-72 per FONT_SPECS). Demo stack: "Newsreader", Georgia, "Times New Roman", serif; display: "Instrument Serif", "Newsreader", Georgia, serif. Weights: body 400, italics for captions/time (13-14px), small caps (font-variant: small-caps) 10-13px with 0.14-0.24em tracking for labels/status/running heads. Risk: many Google fonts synthesise small caps — verify Newsreader has real smcp; if not, use uppercase 11px with 0.16em tracking (unverified). No monospace is defined — code blocks need ui-monospace/SF Mono or a bundled mono (deviation to flag). Optional zero-payload macOS variant: New York (system 'ui-serif'), Charter, Iowan Old Style are present in /System/Library/Fonts — but then it is no longer the catalog look.

SHADOW POLICY: none ('Tiefe existiert nicht, es gibt nur die Seite'). BORDER/HAIRLINE POLICY: 1px hairlines at ~15-25% of text colour (#D6CDB9 on #FBF8F1), 1px ink rules for masthead/list edges, 3px double rules as the page frame; inputs are a text line on a rule (no box); primary button = ink fill, radius 0, small caps 13px 0.18em, hover -> red; secondary = underline only. DENSITY: mittel bis dicht (3); demo rows ~60px because names are 25px display — for a tool set names 16-17px and rows 28-32px (my proposal). MOTION: 120-160ms colour only; focus = 1px dotted red outline offset 3px in demo (weak — I recommend 2px solid red for an app; deviation).

RULES (markers, verbatim): Radius 0px durchgehend -- keine abgerundeten Karten · Trennung ausschließlich über Hairlines: 1px, Deckkraft ca. 15-25 % der Textfarbe · Schatten: keine; Tiefe existiert nicht, es gibt nur die Seite · Serif-Display 44-58px gegen Serif-Werksatz 15-16px: Größensprung >3:1 · Initiale über 2-3 Zeilen, float:left, in Akzentfarbe · Kapitälchen mit Laufweite 0.14-0.24em für Labels, Status und Kolumnentitel · Zeitangaben und Bildunterschriften konsequent kursiv, 13-14px · Papierton statt Weiß: #FBF8F1 statt #FFFFFF, Tinte #17140F statt #000000 · Marginalspalte 70-80px mit vertikaler Hairline als Satzspiegel-Kante.

KNOWN FAILURE MODES (risks, verbatim): Interaktive Dichte ist der Feind: Toolbars, Dropdowns, Tabellen mit 12 Aktionen sprengen den Satzspiegel · Ohne echte Typo-Disziplin wirkt es sofort wie ein unfertiges Word-Dokument · Serifen unter 15px werden auf Android und älteren Windows-Renderern matschig · Kapitälchen sind in vielen Google-Fonts nicht echt, sondern browserseitig synthetisiert · Touch-Ziele: Hairline-Zeilen verleiten zu 32px-Reihen.

ACCESSIBILITY (sheet): ink on paper ~15:1 (measured 17.3:1); small caps 10-12px are at the legibility limit and must carry >= 4.5:1; status never by italic/grey alone — hence the filled/empty square; hairlines vanish in Windows high-contrast, structure must stand without them. TIP (verbatim): Vertikalrhythmus vor Ornament. Leg eine Basiszeile fest (z.B. 24px) und binde jede Zeilenhöhe, jeden Abstand und jede Hairline an ihr Vielfaches.

HOW NOVALIS LOOKS IN EDITORIAL-PRINT: Window = a page: native macOS title bar, then a 'running head' row (Kolumnentitel): small caps 12px 0.16em muted 'vault · folder' left, hairline in the middle, italic red file name + word count right, 1px rule underneath. File tree = the Marginalspalte: 200-240px column with a 1px right rule, folder names as small-caps rubrics, files in Newsreader 15px, modified time italic 12px muted, active file in red with ■ marker, no background fills. Editor: Newsreader 16-17px / 1.55-1.6, measure 66ch, first paragraph of a note may get the 3-line red initial (optional device); h1 Instrument Serif 44-54px 0.92, h2 28px, h3 small caps; blockquote italic with 1px left rule; lists with hanging indent; wikilinks red underline; @due tasks as ■/□ glyph + small-caps date; code blocks in ui-monospace on paper-2 with 1px rule left. Kanban: newspaper columns — vertical 1px rules between columns, column head in small caps 0.22em + Roman numeral (I, II, III as in the demo's rank) + count in Instrument Serif red; cards are entries: title Instrument Serif 20-22px, caption italic 13px, status small caps + ■/□, hairline between cards, no boxes, no radius, no shadow; drag = 1px ink outline, drop target = 1px ink rule. Modals / command palette: a sheet with 3px double rule top and bottom (the demo frame), no shadow, scrim rgba(23,20,15,.25); search field = 'Register' small caps + italic input on a rule; buttons small caps, primary ink fill. Fleuron (❧ U+2767) between hr sections as the single ornament.
_evidence: /Users/sgrundhoefer/Projects/designSprache/styles/editorial-print.json (full), styles/editorial-print.html (full CSS), build.py FONT_SPECS; contrast computed; dark palette DERIVED (ASSUMED)_



## Catalog prompt export (verbatim structure)

```
Verwende die folgende Designsprache als visuelle Grundlage für dieses Projekt. Weiche nicht davon ab, ohne es zu begründen.

# Editorial / Print-Magazin im Web

## Kernidee
Hierarchie entsteht aus Schriftschnitt, Laufweite und Weißraum -- nicht aus Boxen, Schatten oder Farbflächen. Der Bildschirm wird als Papierseite mit Satzspiegel behandelt.

## Harte Parameter
- **Radius:** 0px, ausnahmslos
- **Kontrast:** sehr hoch
- **Dichte:** mittel bis dicht
- **Tiefe:** keine; Ordnung über Linien, Einzüge und Spaltenkanten
- **Farbe:** Papier-Ton plus Tinte plus genau eine gebrochene Akzentfarbe (Zeitungsrot #8C2F1F) für Initiale, Zähler und Hover
- **Typografie:** zwei Serifen-Schnitte: Display mit hohem Strichkontrast für Titel, Lesetyp für Werksatz; Kapitälchen und Kursiv tragen die gesamte Sekundärinformation
- **Motion:** fast keine; 120-160ms Farbwechsel auf Hover, kein Transform, kein Bounce -- Papier bewegt sich nicht
- **Textur:** keine bis minimal: ein weicher Lichtverlauf oben (5 % Weiß) simuliert Papierschlag

## Palette
#FBF8F1  #F4EFE3  #17140F  #857C6C  #D6CDB9  #8C2F1F

## Schriften
Instrument Serif, Newsreader (über Google Fonts, jeweils mit generischem Fallback)

## Regeln, die einzuhalten sind
- Radius 0px durchgehend -- keine abgerundeten Karten
- Trennung ausschließlich über Hairlines: 1px, Deckkraft ca. 15-25 % der Textfarbe
- Schatten: keine; Tiefe existiert nicht, es gibt nur die Seite
- Serif-Display 44-58px gegen Serif-Werksatz 15-16px: Größensprung >3:1
- Initiale über 2-3 Zeilen, float:left, in Akzentfarbe
- Kapitälchen mit Laufweite 0.14-0.24em für Labels, Status und Kolumnentitel
- Zeitangaben und Bildunterschriften konsequent kursiv, 13-14px
- Papierton statt Weiß: #FBF8F1 statt #FFFFFF, Tinte #17140F statt #000000
- Marginalspalte 70-80px mit vertikaler Hairline als Satzspiegel-Kante

## Bekannte Fehlerquellen dieses Stils — vermeide sie
- Interaktive Dichte ist der Feind: Toolbars, Dropdowns, Tabellen mit 12 Aktionen sprengen den Satzspiegel
- Ohne echte Typo-Disziplin (konsistente Laufweiten, gepflegte Vertikalrhythmen) wirkt es sofort wie ein unfertiges Word-Dokument
- Serifen unter 15px werden auf Android und älteren Windows-Renderern matschig
- Kapitälchen sind in vielen Google-Fonts nicht echt, sondern browserseitig synthetisiert -- optisch zu leicht, wenn man es nicht per font-weight korrigiert
- Touch-Ziele: Hairline-Zeilen verleiten zu 32px-Reihen, das ist unter dem 44px-Minimum

## Barrierefreiheit
Kontrast ist die große Stärke: Tinte auf Papierton liegt bei etwa 15:1, weit über AAA. Kritisch sind dagegen die kleinen gesperrten Kapitälchen (10-12px) für Status und Labels -- sie liegen an der Grenze der Lesbarkeit und müssen Farbwerte mit mindestens 4.5:1 tragen; Status darf nie allein über Kursivierung oder Grauwert codiert sein, deshalb steht hier zusätzlich ein gefülltes bzw. leeres Quadrat als Formmerkmal. Hairline-Trenner mit 1px und niedrigem Kontrast verschwinden bei Windows-Hochkontrastmodus vollständig, die Struktur muss also auch ohne sie stehen.

## Praxistipp
Vertikalrhythmus vor Ornament. Leg eine Basiszeile fest (z.B. 24px) und binde jede Zeilenhöhe, jeden Abstand und jede Hairline an ihr Vielfaches -- erst dadurch wirkt die Seite gesetzt statt dekoriert. Initiale, Fleuron und Kapitälchen sind Zugaben; kommen sie ohne Rhythmus, sieht es nach Hochzeitseinladung aus.

---
Quelle: https://grundhofer.github.io/designsprache/de/ — Editorial / Print-Magazin im Web
```
