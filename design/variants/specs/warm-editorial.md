# Spec: Warm Editorial (warm-editorial)

Catalog mode: light. Demo to look at: /Users/sgrundhoefer/Projects/designSprache/styles/warm-editorial.html · Fact sheet: /Users/sgrundhoefer/Projects/designSprache/styles/warm-editorial.json

## From the design report

### F6. SPEC 4 — Warm Editorial (slug: warm-editorial) — recommended #4 direction (warm paper, reading-first, 'Quiet Software')  [verified]
DEMO TO LOOK AT: styles/warm-editorial.html (light only; note the paper grain and vignette are demo devices). Family Produkt-Ästhetik heute. Scores longevity 5 / recognition 3 / effort 3 / density 2. Finder: mode light, a11y 4, platform web 5 mobile 3 desktop 2, fits content/marketing, tone warm/calm. Signature: 'Gesperrte Versalien-Mikrolabels in Grotesk über einer Serifen-Lesekolumne von 66 Zeichen.' Verdict caveat: 'Als alleinige Basis … die falsche Dichte – sobald eine Tabelle, Einstellungsmaske oder Dashboard' — but 'Wer nur schreib- und lesezentrierte Apps baut, kann den Stil bedenkenlos durchziehen'. Aka: Paper UI, Reading-First Interface, Notion-Substack-Look, Quiet Software. The sheet's own fatigue argument is the strongest reason to include it: 'Reinweiß #FFFFFF bei hoher Leuchtdichte strengt bei stundenlangem Lesen an … leicht gelbstichige Papiertöne … tragen längere Sitzungen'.

CORE IDEA (verbatim): Die Oberfläche gibt sich als bedrucktes Blatt aus: warmes Papier statt Reinweiß, eine Serifenschrift trägt die Inhaltsebene, und Struktur entsteht aus Weißraum, Linealen und typografischer Hierarchie statt aus Kästen und Farbe.

EIGHT HARD PARAMETERS (verbatim): Radius 8-14px an Flächen, 0px an Feldern und Trennlinien. Kontrast hoch. Dichte luftig. Tiefe: kaum vorhanden: ein weicher warmer Schlagschatten hebt das Blatt vom Grund ab, im Inneren trennen nur Lineale. Farbe: Warme Neutrals mit Gelb-/Rotanteil plus genau ein erdiger Akzent; semantische Farben gedämpft statt gesättigt. Typografie: Serifen-Display für Überschriften, Leseserife für Inhalt, Grotesk nur für gesperrte Mikro-Labels. Motion: Zurückhaltend, 200-260ms ease; Farb- und Hintergrundwechsel statt Bewegung, maximal 1px Anhebung. Textur: Papierkorn als SVG-Noise bei 20-25% Deckkraft plus ein sehr weiter warmer Vignetten-Gradient (RECOMMEND OFF under editor text; keep at most on the outer paper).

GRID/SPACING: generous: 40-56px inner padding on the sheet (demo 40px 44px 36px), reading measure 60-72ch (demo 64ch), line-height 1.6-1.75, headline 40-60px at 0.95-1.05 line-height -0.015em; rows 17px 0 15px in demo (~56px). For novalis: keep the 40-56px only around the editor sheet; sidebar paddings 12-16px and 32px tree rows (my deviation — the sheet's density is its documented weakness for tool windows).

PALETTE LIGHT (catalog demo tokens, verified): paper #FAF7F2; sheet #FFFDFA; tint #F3EEE4 (hover/selection); ink #2B2622 (14.0:1); ink-2 #5C5348 (7.05:1 — labels, placeholders); ink-3 #8A7E6F (3.7:1 — casual meta only: folio numbers, kicker); rule #E4DACA; rule-soft #EFE7D9; accent #A8432A terracotta (5.6:1); green #4F6B4E (5.5:1); ochre #8A6A1E (4.7:1). Warm shadow stack (demo): 0 1px 2px rgba(76,58,36,.05), 0 10px 24px -12px rgba(96,74,46,.16), 0 34px 70px -34px rgba(84,64,38,.30).
PALETTE DARK (DERIVED by me, hue 34-40 kept per the tip; the sheet says a dedicated warm dark palette is required and gives none): paper #1E1A16; sheet #262119 (1.08:1 vs paper — the lift must come from the border + shadow, not from contrast); tint #2C2620; ink #EFE7DC (14.1:1); ink-2 #C9BFB0 (9.5:1); ink-3 #9A8F80 (5.5:1); rule #3B342B; rule-soft #2F2923; accent #E07A57 (5.8:1); green #8DB58A (7.5:1); ochre #D2AB55 (8.0:1); shadows rgba(0,0,0,.4-.6) but warm-tinted e.g. rgba(10,6,2,.5).
SIGNAL BUDGET: one earthy accent (terracotta/brick/ochre family) for numbers, brand, focus; semantic states muted green / ochre, always accompanied by the word and position (demo: 14x2px dash before the label instead of a dot). Never a neutral grey or pure #000 anywhere (tip: 'Ein einziges neutrales Grau oder ein reines #000 im Schatten reißt die Illusion sofort auf').

FONTS: Instrument Serif (display, SIL OFL 1.1 verified, Regular+Italic only), Newsreader (reading, SIL OFL 1.1 verified, variable wght/opsz), Inter (micro labels only, SIL OFL 1.1 verified). Stacks (demo): "Newsreader", Georgia, "Times New Roman", serif; "Instrument Serif", Georgia, serif; "Inter", system-ui, sans-serif. Sizes: masthead 58px/400/.96; deck 18px/1.7; entries 21px/1.25; body 16-21px/1.6-1.75; micro labels 9.5-11px 500-600 caps 0.14-0.18em (>= 10px, ink-2 for anything read); times italic 15px; Instrument Serif numerals with "onum". Risk: serif webfonts need real italics and oldstyle figures or 'wirkt der Satz billig'.

SHADOW POLICY: soft, diffuse, large negative spread, < 20% opacity, ALWAYS warm-tinted; one 'sheet' level only; primary button gets an inset 1px highlight + warm drop. BORDER/HAIRLINE POLICY: rules in warm beige (#E4DACA / #EFE7D9), never grey; fields are underline-only (border-bottom 1px ink, focus -> accent + 2px shadow line), radius 0 on fields and rules; sheet border 1px rule-soft. RADIUS: 8-14px on surfaces (demo sheet 14px, primary button 10px). DENSITY: luftig (2). MOTION: 200-260ms ease (demo 200-220ms cubic-bezier(.2,.7,.3,1) on buttons), hover row = tint gradient, primary hover = translateY(-1px), reduced-motion respected.

RULES (markers, verbatim): Grundfläche #FAF7F2 / #F5F1EA statt #FFFFFF - warm getönt, nie neutralgrau · Tinte nie reines Schwarz: #2B2622 bis #37352F mit sichtbarem Rot-/Gelbanteil · Serifen-Headline in 40-60px, Zeilenhöhe 0.95-1.05, letter-spacing -0.015em · Lesetext 16-21px mit line-height 1.6-1.75 und Messweite 60-72 Zeichen · Großzügige Außenränder: 40-56px Innenabstand am Blatt · Hairlines in warmem Beige (#E4DACA), nicht in Grau - Trennung über Lineale statt über Karten · Schatten weich und diffus mit großem negativem Spread, Deckkraft unter 20%, immer warm eingefärbt · Radius 8-14px an Flächen, 0px an Linealen und Feldern (Unterstrich statt Kasten) · Micro-Labels als gesperrte Versalien in einer Grotesk, 9-11px, letter-spacing 0.14-0.18em · Genau ein warmer Akzent (Terracotta, Brick, Ochre) für Zahlen, Marken und Fokuszustände.

KNOWN FAILURE MODES (risks, verbatim): Falsche Dichte für Applikations-UI: Tabellen, Dashboards und Einstellungsmasken vertragen die Luftigkeit nicht · Serifen-Webfonts kosten Payload und brauchen echte Kursive und Mediävalziffern · Der schmale Grat zum Wellness-Look: zu viel Beige, zu viel Rundung und zu wenig Kontrast lassen ein Entwicklerwerkzeug wie eine Meditations-App aussehen · Dark-Mode ist nicht trivial - Papiertöne lassen sich nicht einfach invertieren, es braucht eine eigene warme Dunkelpalette · Ohne strenges Raster kippt die Großzügigkeit in Beliebigkeit.

ACCESSIBILITY (sheet): #2B2622 on #FAF7F2 ~13:1 (measured 14:1); large line-height and limited measure match dyslexia recommendations; small caps under 10px and italic serif placeholders are hard to read; ink-3 #8A7E6F (3.9:1) only for casual metadata, labels/placeholders in ink-2 #5C5348 (7.4:1); the paused ochre pulled to #8A6A1E (~5:1) because it is set at 9.5px caps; status additionally coded by wording and position. TIP (verbatim): Warm sein heißt nicht beige sein: den Farbton einmal festlegen (etwa Hue 34-40) und konsequent durch die gesamte Skala ziehen - Papier, Tinte, Lineale, Schatten und sogar die Statusfarben.

HOW NOVALIS LOOKS IN WARM EDITORIAL: Window: native macOS title bar, everything on paper #FAF7F2. The editor is 'the sheet': a #FFFDFA panel radius 14px, 1px rule-soft border, the warm 3-layer shadow, 40-56px inner padding, prose Newsreader 17-18px/1.7 at 64ch, h1 Instrument Serif 40-58px, kicker line above the title (Inter 10px caps 0.18em: 'Notizen / Projekte / …' + date) with a rule in the middle; wikilinks in accent; @due tasks as italic dates with a 2px dash; code in ui-monospace on tint. File tree: sits directly on paper without a box: section heads as Inter micro-labels (ink-3, 10px caps), entries Newsreader 15px with dotted leaders (demo .leader) to an italic time, active = accent text, hover = tint gradient; folders indented, counts in Instrument Serif oldstyle figures. Kanban: columns are sheets (radius 14px, warm shadow) on paper, head = Instrument Serif 26-30px + Inter micro-label count; cards inside separated by rule-soft hairlines (no card boxes — the sheet is the container), title Newsreader 17px, meta italic, state micro-label green/ochre with dash; drag = card lifts 1px with warm shadow; alternative with cards as small radius-8px sheets is possible but doubles shadows (not recommended). Modals / command palette: a sheet radius 14px with the warm shadow on a warm scrim rgba(43,38,34,.35); search field = micro-label + italic underline input; primary button dark-ink radius 10px with inset highlight, quiet button = underline. Dark mode: same structure on the derived warm dark ladder; the sheet lifts by border + shadow only.
_evidence: /Users/sgrundhoefer/Projects/designSprache/styles/warm-editorial.json (full), styles/warm-editorial.html (full CSS); contrast computed; dark palette DERIVED (ASSUMED)_



## Catalog prompt export (verbatim structure)

```
Verwende die folgende Designsprache als visuelle Grundlage für dieses Projekt. Weiche nicht davon ab, ohne es zu begründen.

# Warm Editorial

## Kernidee
Die Oberfläche gibt sich als bedrucktes Blatt aus: warmes Papier statt Reinweiß, eine Serifenschrift trägt die Inhaltsebene, und Struktur entsteht aus Weißraum, Linealen und typografischer Hierarchie statt aus Kästen und Farbe.

## Harte Parameter
- **Radius:** 8-14px an Flächen, 0px an Feldern und Trennlinien
- **Kontrast:** hoch
- **Dichte:** luftig
- **Tiefe:** kaum vorhanden: ein weicher warmer Schlagschatten hebt das Blatt vom Grund ab, im Inneren trennen nur Lineale
- **Farbe:** Warme Neutrals mit Gelb-/Rotanteil plus genau ein erdiger Akzent; semantische Farben gedämpft statt gesättigt
- **Typografie:** Serifen-Display für Überschriften, Leseserife für Inhalt, Grotesk nur für gesperrte Mikro-Labels
- **Motion:** Zurückhaltend, 200-260ms ease; Farb- und Hintergrundwechsel statt Bewegung, maximal 1px Anhebung
- **Textur:** Papierkorn als SVG-Noise bei 20-25% Deckkraft plus ein sehr weiter warmer Vignetten-Gradient

## Palette
#FAF7F2  #F3EEE4  #E4DACA  #2B2622  #A8432A  #8A7E6F

## Schriften
Instrument Serif, Newsreader, Inter (über Google Fonts, jeweils mit generischem Fallback)

## Regeln, die einzuhalten sind
- Grundfläche #FAF7F2 / #F5F1EA statt #FFFFFF - warm getönt, nie neutralgrau
- Tinte nie reines Schwarz: #2B2622 bis #37352F mit sichtbarem Rot-/Gelbanteil
- Serifen-Headline in 40-60px, Zeilenhöhe 0.95-1.05, letter-spacing -0.015em
- Lesetext 16-21px mit line-height 1.6-1.75 und Messweite 60-72 Zeichen
- Großzügige Außenränder: 40-56px Innenabstand am Blatt, deutlich mehr als in App-UIs üblich
- Hairlines in warmem Beige (#E4DACA), nicht in Grau - Trennung über Lineale statt über Karten
- Schatten weich und diffus mit großem negativem Spread, Deckkraft unter 20%, immer warm eingefärbt
- Radius 8-14px an Flächen, 0px an Linealen und Feldern (Unterstrich statt Kasten)
- Micro-Labels als gesperrte Versalien in einer Grotesk, 9-11px, letter-spacing 0.14-0.18em
- Genau ein warmer Akzent (Terracotta, Brick, Ochre) für Zahlen, Marken und Fokuszustände

## Bekannte Fehlerquellen dieses Stils — vermeide sie
- Falsche Dichte für Applikations-UI: Tabellen, Dashboards und Einstellungsmasken vertragen die Luftigkeit nicht und müssen entweder brechen oder den Stil verwässern
- Serifen-Webfonts kosten Payload und brauchen echte Kursive und Mediävalziffern, sonst wirkt der Satz billig
- Der schmale Grat zum Wellness-Look: zu viel Beige, zu viel Rundung und zu wenig Kontrast lassen ein Entwicklerwerkzeug wie eine Meditations-App aussehen
- Dark-Mode ist nicht trivial - Papiertöne lassen sich nicht einfach invertieren, es braucht eine eigene warme Dunkelpalette
- Ohne strenges Raster kippt die Großzügigkeit in Beliebigkeit; Weißraum ohne System sieht nach Unentschlossenheit aus

## Barrierefreiheit
Der Stil ist von Haus aus barrierearm: #2B2622 auf #FAF7F2 erreicht etwa 13:1, und die großen Zeilenabstände sowie die begrenzte Messweite entsprechen genau den Empfehlungen für Leseschwäche und Dyslexie. Die Risiken liegen an den Rändern - gesperrte Versalien unter 10px und kursive Serifen als Platzhalter sind schlecht erfassbar, und Sekundärtext in #8A7E6F liegt bei etwa 3,9:1 und darf deshalb nur für beiläufige Metadaten wie Kolumnentitel und Ziffern verwendet werden - Formularlabel und Platzhalter laufen hier bewusst eine Stufe dunkler in #5C5348 (rund 7,4:1). Die gedämpfte Ockerfarbe des Pausiert-Zustands ist aus demselben Grund auf #8A6A1E gezogen (rund 5:1), weil sie in 9,5px-Versalien gesetzt ist. Statuslabels sind hier zusätzlich durch Wortlaut und Position codiert, sodass die gedämpften Farben Grün und Ocker nicht allein die Information tragen.

## Praxistipp
Warm sein heißt nicht beige sein: der Trick ist, den Farbton einmal festzulegen (etwa Hue 34-40) und ihn dann konsequent durch die gesamte Skala zu ziehen - Papier, Tinte, Lineale, Schatten und sogar die Statusfarben bekommen denselben leichten Rot-Gelb-Einschlag. Ein einziges neutrales Grau oder ein reines #000 im Schatten reißt die Illusion sofort auf und lässt das Ergebnis nach einem verunglückten Standard-Theme aussehen.

---
Quelle: https://grundhofer.github.io/designsprache/de/ — Warm Editorial
```
