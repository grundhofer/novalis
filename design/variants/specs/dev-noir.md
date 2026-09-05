# Spec: Dev-Noir (dev-noir)

Catalog mode: dark. Demo to look at: /Users/sgrundhoefer/Projects/designSprache/styles/dev-noir.html · Fact sheet: /Users/sgrundhoefer/Projects/designSprache/styles/dev-noir.json

## From the design report

### F5. SPEC 3 — Dev-Noir (slug: dev-noir) — recommended #3 direction (dark-first, command-palette, mono metadata)  [verified]
DEMO TO LOOK AT: styles/dev-noir.html (dark only; note it shows the full vocabulary incl. glow, grid and film noise). Family Produkt-Ästhetik heute. Scores longevity 4 / recognition 3 / effort 3 / density 4. Finder: mode dark, a11y 3, platform web 5 mobile 2 desktop 5, fits dev-tool/data/internal, tone precise/technical/calm. Signature: 'Sichtbare Tastenkürzel-Badges und Monospace-Metadaten in jeder Zeile; die Maus ist optional.' Verdict demands three own decisions — a NON-violet accent, an own type combination, a signature component (the kbd badges) — and 'zwingend mit einem gleichwertig gepflegten Light-Theme'.

CORE IDEA (verbatim): Tiefe entsteht nicht durch Schatten, sondern durch minimal aufgehellte Layer und 1px-Hairlines; Farbe ist bis auf einen einzigen Akzent verboten, damit Zustand und Hierarchie allein aus Helligkeitsstufen und Monospace-Metadaten lesbar bleiben.

EIGHT HARD PARAMETERS (verbatim): Radius 6-8px Controls, 10-12px Container. Kontrast hoch. Dichte dicht. Tiefe: Layer-Ladder aus minimal helleren Flächen plus 1px-Hairlines; Glow nur an Primäraktionen. Farbe: Neutrale Grauskala mit 8-12 bewussten Stufen plus genau ein Akzent und zwei semantische Statusfarben (Grün/Amber). Typografie: Eine Grotesk im Gewichtsband 400-550 mit negativem Tracking, dazu Monospace für alles Maschinelle. Motion: 120-180ms, cubic-bezier(.2,0,0,1), ausschließlich Opazitäts-, Farb- und 1-2px-Translationen. Textur: Film-Noise 2-4% über dem gesamten Canvas plus optionales 56px-Grid bei 3% unter einer radialen Maske (RECOMMEND OFF for a writing tool — noise under prose; the sheet itself names glow/gradient as the part that will date first).

GREY LADDER (tip: 8-12 named steps, one job each: Canvas, Surface, Raised, Border, Border-Strong, Text-3, Text-2, Text). PALETTE DARK (catalog demo tokens, verified): bg #08080B; surface #0D0E12 (+3-5%); raised #14151A (+7-9%); line rgba(255,255,255,.07); line-strong rgba(255,255,255,.11); line-control rgba(255,255,255,.36) (~3.2:1, for input borders); text #EDEDEF (17.1:1); text-2 #A2A2AE (7.9:1); text-3 #71717F (4.2:1 — secondary/mono meta only); accent #7C86E8 (6.1:1) / accent-deep #5E6AD2 (Linear violet — replace per verdict); green #4CC38A (9.0:1); amber #E3A455 (9.3:1); status pill: bg rgba(76,195,138,.09), border .22, text #7FD8AC; ease cubic-bezier(.2,0,0,1).
PALETTE LIGHT (anchor values #FAFAFA / #171717 are cited in the sheet's Vercel Geist example; the rest DERIVED by me): canvas #FAFAFA; surface #FFFFFF; raised #F4F4F5; line rgba(0,0,0,.08); line-strong rgba(0,0,0,.12); line-control rgba(0,0,0,.30); text #171717 (17.2:1); text-2 #525252 (7.5:1); text-3 #737373 (4.5:1); accent #4F5BD5 (5.3:1, placeholder hue); green #1F8A5B measures only 4.15:1 -> darken to ~#176F49 for text or pair with icon (unverified); amber #9A5B0B (5.2:1).
SIGNAL BUDGET: one accent + two semantic (green ok / amber warn), on a pure grey scale; status dot always accompanied by a text label; pulsing dot off under prefers-reduced-motion.

FONTS: Inter (SIL OFL 1.1 verified; old novalis already bundles @fontsource-variable/inter 5.2.8) and Geist Mono (SIL OFL 1.1 verified, Vercel + basement.studio). Stacks from demo: "Inter", system-ui, -apple-system, sans-serif; "Geist Mono", ui-monospace, SFMono-Regular, monospace. Weight band 400-550 (needs the variable font: demo uses 450 for names, 550 for headings), letter-spacing -0.02em at >= 16px, -0.022em headings; mono 10-11px with tabular-nums for time, IDs, counters, shortcuts, status bar. Demo sizes: body 14px/1.5, title bar 38px, h2 17px/550, row 13.5px names, meta 11px mono, input 34px radius 8px, buttons 32px radius 7px 12.5px/500, kbd 18px radius 4px 10px mono, status bar 28px mono 10px.

SHADOW POLICY: no drop shadows between surfaces (depth = lighter layer + hairline); glow only on the primary action (box-shadow accent 20-40% alpha, large negative spread) and on focus (3px near-opaque accent ring); the app frame in the demo carries a deep 0 32px 90px -26px rgba(0,0,0,.95) — acceptable for modals/palette only. BORDER/HAIRLINE: decorative hairlines .06-.11 white (1.15-1.3:1, decorative only); interactive borders one clearly lighter step .30-.40 (>= 3:1); never mix the two roles. RADIUS: exactly one step per class: 6-8px controls, 10-12px containers. DENSITY: dense — 13-14px UI, rows ~40-44px (demo: 11px vertical padding), tree rows 28px (my proposal). MOTION: 120-180ms cubic-bezier(.2,0,0,1); never scale > 1.02; hover = +2.8% white background + 2px accent left bar (demo).

RULES (markers, verbatim): Grundfläche #08080B-#0F1015, Layer-Ladder Base -> Surface (+3-5% Helligkeit) -> Raised (+7-9%) · Trenner ausschließlich 1px solid rgba(255,255,255,.06-.11) - keine Schlagschatten zwischen Flächen · Bedienbare Ränder liegen eine eigene, deutlich hellere Stufe höher (rgba(255,255,255,.30-.40)) als die dekorativen Hairlines · Radius genau eine Stufe: 6-8px für Controls, 10-12px für Container · Typo Inter/Geist in schmalem Gewichtsband 400-550, letter-spacing -0.02em ab 16px aufwärts · Monospace (Geist Mono/JetBrains Mono) für Zeit, IDs, Zähler, Shortcuts, mit font-variant-numeric: tabular-nums · Genau ein Akzent (Linear #5E6AD2, Raycast #FF6363, Vercel: gar keiner) auf sonst reiner Grauskala · Glow statt Schatten: box-shadow mit Akzentfarbe bei 20-40% Deckkraft und großem negativem Spread · Radiale Hintergrund-Gradients bei 6-25% Deckkraft (optional, dating) · Motion 120-180ms mit cubic-bezier(.2,0,0,1), keine Bounces, keine Skalierung über 1.02 · Keyboard-Shortcut-Badges (kbd) als sichtbare Signatur in Titelleiste, Feld und Buttons.

KNOWN FAILURE MODES (risks, verbatim): Extrem verbreitet - ohne eigene Akzentfarbe, eigene Typo-Details und eigene Motion-Signatur ist das Ergebnis austauschbar · Hairlines bei 6-8% Deckkraft sind auf schlechten Displays, im Sonnenlicht und bei älteren Augen faktisch unsichtbar · Der radiale Glow ist der datierbare Teil · Dark-only schließt Nutzer mit Astigmatismus aus (heller Text auf dunklem Grund messbar schlechter lesbar) -> light theme is mandatory · Kippt ins Billige, sobald Neon-Akzente, mehrere Glows und übertriebene Gradients zusammenkommen.

ACCESSIBILITY (sheet): hairlines at 7-11% white are decorative only; input frames must reach 3:1 via the .36 step plus a 3px focus ring in near-opaque accent (~4.2:1); #EDEDEF on #08080B instead of #FFF on #000 to avoid halation; mono meta #71717F is 4.1:1 -> secondary information only; status never colour-alone; pulsing indicator off under reduced motion. TIP (verbatim): Baue die Grauskala als echte Leiter mit acht bis zwölf benannten Stufen und weise jeder Stufe genau eine Aufgabe zu.

HOW NOVALIS LOOKS IN DEV-NOIR: Window: borderless Tauri window with its OWN 38px title bar (demo): small mark, mono breadcrumb 'vault / folder / note.md' in text-3 with the file in text-2, ⌘K kbd badge right; traffic lights inset. File tree: surface level (#0D0E12) with a 1px hairline right border; rows 28px, 13px/450 names, folder chevrons in text-3, hover +2.8% white, active row = 2px accent left bar + raised background; counts as mono pills (19px, radius 999px, hairline border). Editor: on base canvas; prose Inter 15-16px/450, line-height 1.6, measure 68-72ch; headings 550 -0.022em; markdown syntax marks in text-3; inline code/code blocks in Geist Mono 13px on surface with hairline border radius 6px; wikilinks in accent; @due dates in mono amber; 28px status bar at the bottom in mono 10px: words · line:col · 'sync 14:02' with 5px green dot (the Sublime-like element). Kanban: columns = containers radius 10-12px on surface with hairline border, head 13px/550 + mono count pill; cards = raised (#14151A) radius 6-8px with 1px line-strong border, no shadow, title 13.5px/450, meta mono 11px, status = 6px dot + pill label (green/amber); linked note = mono file name with a small glyph; drag = accent glow ring; drop target = hairline -> line-strong. Modals / command palette: raised container radius 10-12px, 1px line-strong border, the deep app-frame shadow allowed here, 34px input with '/' kbd, results as tree rows, footer with kbd hints; buttons 32px radius 7px, primary = accent gradient with kbd badge, ghost = .04 white fill. Light mode: same structure on #FAFAFA / #FFFFFF / #F4F4F5 with black hairlines .08/.12/.30.
_evidence: /Users/sgrundhoefer/Projects/designSprache/styles/dev-noir.json (full), styles/dev-noir.html (full CSS); Geist light anchors from the sheet's examples; light ladder DERIVED (ASSUMED); contrast computed; /Users/sgrundhoefer/Projects/novalis/apps/desktop/frontend/package.json (@fontsource-variable/inter)_



## Catalog prompt export (verbatim structure)

```
Verwende die folgende Designsprache als visuelle Grundlage für dieses Projekt. Weiche nicht davon ab, ohne es zu begründen.

# Dev-Noir

## Kernidee
Tiefe entsteht nicht durch Schatten, sondern durch minimal aufgehellte Layer und 1px-Hairlines; Farbe ist bis auf einen einzigen Akzent verboten, damit Zustand und Hierarchie allein aus Helligkeitsstufen und Monospace-Metadaten lesbar bleiben.

## Harte Parameter
- **Radius:** 6-8px Controls, 10-12px Container
- **Kontrast:** hoch
- **Dichte:** dicht
- **Tiefe:** Layer-Ladder aus minimal helleren Flächen plus 1px-Hairlines; Glow nur an Primäraktionen
- **Farbe:** Neutrale Grauskala mit 8-12 bewussten Stufen plus genau ein Akzent und zwei semantische Statusfarben (Grün/Amber)
- **Typografie:** Eine Grotesk im Gewichtsband 400-550 mit negativem Tracking, dazu Monospace für alles Maschinelle
- **Motion:** 120-180ms, cubic-bezier(.2,0,0,1), ausschließlich Opazitäts-, Farb- und 1-2px-Translationen
- **Textur:** Film-Noise 2-4% über dem gesamten Canvas plus optionales 56px-Grid bei 3% unter einer radialen Maske

## Palette
#08080B  #0D0E12  #14151A  #5E6AD2  #EDEDEF  #71717F

## Schriften
Inter, Geist Mono (über Google Fonts, jeweils mit generischem Fallback)

## Regeln, die einzuhalten sind
- Grundfläche #08080B-#0F1015, Layer-Ladder Base -> Surface (+3-5% Helligkeit) -> Raised (+7-9%)
- Trenner ausschließlich 1px solid rgba(255,255,255,.06-.11) - keine Schlagschatten zwischen Flächen
- Bedienbare Ränder liegen eine eigene, deutlich hellere Stufe höher (rgba(255,255,255,.30-.40)) als die dekorativen Hairlines
- Radius genau eine Stufe: 6-8px für Controls, 10-12px für Container
- Typo Inter/Geist in schmalem Gewichtsband 400-550, letter-spacing -0.02em ab 16px aufwärts
- Monospace (Geist Mono/JetBrains Mono) für Zeit, IDs, Zähler, Shortcuts, mit font-variant-numeric: tabular-nums
- Genau ein Akzent (Linear #5E6AD2, Raycast #FF6363, Vercel: gar keiner) auf sonst reiner Grauskala
- Glow statt Schatten: box-shadow mit Akzentfarbe bei 20-40% Deckkraft und großem negativem Spread
- Radiale Hintergrund-Gradients bei 6-25% Deckkraft, meist oben links/rechts außerhalb des Viewports verankert
- Motion 120-180ms mit cubic-bezier(.2,0,0,1), keine Bounces, keine Skalierung über 1.02
- Keyboard-Shortcut-Badges (kbd) als sichtbare Signatur in Titelleiste, Feld und Buttons

## Bekannte Fehlerquellen dieses Stils — vermeide sie
- Extrem verbreitet - ohne eigene Akzentfarbe, eigene Typo-Details und eigene Motion-Signatur ist das Ergebnis austauschbar
- Hairlines bei 6-8% Deckkraft sind auf schlechten Displays, im Sonnenlicht und bei älteren Augen faktisch unsichtbar
- Der radiale Glow ist der datierbare Teil: er wird die Grauskala und die Hairlines um Jahre nicht überleben
- Dark-only schließt Nutzer mit Astigmatismus aus, für die heller Text auf dunklem Grund messbar schlechter lesbar ist
- Kippt ins Billige, sobald Neon-Akzente, mehrere Glows und übertriebene Gradients zusammenkommen - dann wird daraus Cyberpunk-Kitsch

## Barrierefreiheit
Die Hairlines bei 7-11% Weiß erreichen nur etwa 1,15-1,3:1 und sind damit ausschließlich als dekorative Trenner zulässig - der Rahmen eines Eingabefeldes muss dagegen 3:1 erreichen, hier über eine eigene Stufe rgba(255,255,255,.36) (rund 3,2:1 gegen den Feldgrund) plus einen 3px-Focus-Ring in nahezu deckender Akzentfarbe (rund 4,2:1). Reinweißer Text auf reinem Schwarz erzeugt Halation, deshalb #EDEDEF auf #08080B statt #FFF auf #000; die Mono-Metadaten in #71717F liegen bei rund 4,1:1 und sind deshalb bewusst nur als Sekundärinformation gesetzt. Status wird nie allein über Farbe kommuniziert: der farbige Dot ist immer von einem Textlabel begleitet, und der pulsierende Aktiv-Indikator wird unter prefers-reduced-motion abgeschaltet.

## Praxistipp
Baue die Grauskala als echte Leiter mit acht bis zwölf benannten Stufen und weise jeder Stufe genau eine Aufgabe zu (Canvas, Surface, Raised, Border, Border-Strong, Text-3, Text-2, Text). Sobald Flächen und Borders aus derselben durchdachten Leiter kommen statt aus ad hoc gewürfelten rgba-Werten, wirkt der Stil teuer - und der häufigste Fehler, nämlich Glow und Gradient als Ersatz für eine fehlende Struktur einzusetzen, erledigt sich von selbst.

---
Quelle: https://grundhofer.github.io/designsprache/de/ — Dev-Noir
```
