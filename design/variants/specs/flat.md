# Spec: Flat 2.0 (Kontrollreihe) (flat)

Catalog mode: both. Demo to look at: /Users/sgrundhoefer/Projects/designSprache/styles/flat.html · Fact sheet: /Users/sgrundhoefer/Projects/designSprache/styles/flat.json

## From the design report

### F9. Two non-finalists worth keeping in view: Flat 2.0 as substrate, E-Paper as an optional focus/print mode; and what the catalog says to steal from others  [verified]
FLAT 2.0 (styles/flat.json, demo styles/flat.html lower panel): the only style with finder.mode 'both', effort 1, desktop 5 ('Ideal für Tauri: keine GPU-Filter, keine Repaint-Probleme im WebView'). Tokens: radius 4-6px, exactly ONE shadow step 0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.10), 1px border #E2E2E2 as the container marker, hover as 4-8% lightness shift, 100-150ms linear; demo accessible accents #0A6CA8 blue / #0E7A5F teal / #B81100 red / #C25E00 amber (the historical Metro values #1BA1E2/#00ABA9 fail at ~2.6:1); font Work Sans (not verified license). Verdict: 'Als technisches Substrat: ja, praktisch alternativlos… Als Marke: nein'. Practical use for novalis: the discipline 'genau eine Schattenstufe und genau einen Radiuswert für das ganze Produkt' plus 'jedem interaktiven Element neben der Farbe einen zweiten Marker' applies to all four specs, and a Flat 2.0 control mockup would cost an afternoon.

E-PAPER (styles/e-paper.json, demo styles/e-paper.html): 16-step grey ladder from #2B2B2B to #E4E2DD (values in the demo), contrast capped at 10.9:1, no alpha anywhere, 2px minimum stroke, radius 0, transition: none, selection = full row inversion, pagination instead of scroll; fonts Literata + Inter. Verdict: 'als Modus ja, als Marke nein, als Übung unbedingt' and platforms.desktop: 'Gut für ein Lese-, Schreib- oder Fokuswerkzeug in Tauri, wo Ruhe der Zweck ist'. It is the cheapest possible 'Fokus-/Druckmodus' (two hex values + a ladder) and the only style whose dark mode is a pure ladder inversion — but it has no status colour (Kanban would be ■/□ only) and the sheet warns that on an emissive display it 'liest sich schnell als graue, halb geladene oder kaputte Seite'. Adding it is a FEATURE (a mode), so it needs the owner's ask first.

TRANSFERABLE PARTS the catalog itself recommends from rejected styles (all optional, all need owner decision): terminal-mono -> mono for numbers/IDs/status bar only (already inside dev-noir); data-dense -> font-variant-numeric: tabular-nums globally + right-aligned numeric columns (a free win for any style); civic-service -> the focus-state-first discipline (build the focus utility before any component; 3px transparent outline under every focus for forced-colour modes); material-expressive -> the METHOD (tone ladder, colour roles as pairs, state layers in %, a 3-value shape scale), not the look; spatial-depth -> nothing needed; neo-brutalism/memphis/etc. -> nothing for a calm tool.
_evidence: styles/flat.json, styles/flat.html, styles/e-paper.json, styles/e-paper.html, terminal-mono.json, data-dense.json, civic-service.json, material-expressive.json verdict/tip fields_



## Catalog prompt export (verbatim structure)

```
Verwende die folgende Designsprache als visuelle Grundlage für dieses Projekt. Weiche nicht davon ab, ohne es zu begründen.

# Flat Design & Flat 2.0

## Kernidee
Der Bildschirm gibt zu, dass er ein Bildschirm ist: keine simulierte Tiefe, sondern Farbe, Typografie und Weißraum als einzige Träger von Struktur und Bedeutung. Flat 2.0 nimmt genau so viel Tiefe zurück, wie für erkennbare Bedienbarkeit nötig ist - eine Schattenstufe, kein Millimeter mehr.

## Harte Parameter
- **Radius:** 0px (1.0) bzw. 4-6px (2.0)
- **Kontrast:** hoch
- **Dichte:** mittel bis luftig - große Typo, große Farbflächen, wenig Elemente pro Bildschirm
- **Tiefe:** keine; Trennung über Farbfläche, 4px-Fugen und 1px-Linien. Flat 2.0 fügt genau eine Schattenstufe plus 1px-Border als Container-Marker hinzu
- **Farbe:** Wenige, stark gesättigte Vollton-Akzente auf Weiß oder Schwarz; jede Farbe hat eine feste semantische Rolle
- **Typografie:** Eine Grotesk in extremer Gewichtsspreizung - sehr dünn und sehr groß für Titel, normal für Inhalt, Versalien für Labels
- **Motion:** sachlich und schnell: 100-200ms linear oder ease-out, Deckkraft und Position, kein Federn
- **Textur:** keine - explizit 'authentically digital'

## Palette
#1BA1E2  #00ABA9  #E51400  #A4C400  #007AFF  #FFFFFF

## Schriften
Work Sans (über Google Fonts, jeweils mit generischem Fallback)

## Regeln, die einzuhalten sind
- Radius 0px in Flat 1.0, 4-8px in Flat 2.0 - dazwischen gibt es nichts
- Null Verläufe: jede Fläche ist genau eine Volltonfarbe
- Flat 1.0: box-shadow: none überall; Flat 2.0: genau EINE Stufe, 0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.10)
- Trennung über 1px-Hairlines (#E2E2E2) oder über 4px-Kachelabstände, nie über Tiefe
- Dünne Grotesk: Titel in Weight 200-300, 48-56px, Tracking -0.035em
- Mikrotext in Versalien mit 0.14-0.16em Laufweite als einziges Auszeichnungsmittel
- Geometrische Icons, Konturstil, Strichstärke 1,5px, stroke-linecap: square, kein Fill
- Farbe ist Bedeutung, nicht Dekoration: Status wird über die Vollfläche der Zeile codiert
- Zustandswechsel als reiner Farbsprung, 100-150ms linear, kein Bounce

## Bekannte Fehlerquellen dieses Stils — vermeide sie
- Der berühmte Affordanz-Kollaps von Flat 1.0: Button und Beschriftung sind visuell nicht mehr unterscheidbar - der 'flat text button' gilt bis heute als UX-Antipattern
- Wenn Farbe der einzige Bedeutungsträger ist, fällt die Bedeutung für farbfehlsichtige Nutzer und in Graustufen komplett aus
- Dünne Weights unter 300 brechen bei kleinen Größen und auf schlechten Displays weg
- Volltonfarben mit hoher Helligkeit (#1BA1E2, #A4C400, #007AFF) tragen weißen Text nur bei 2,5-4:1 - die authentischen Metro-Werte sind nicht konform
- Flat 2.0 hat null Wiedererkennung: es ist exakt der Default-Look jedes Frameworks und jedes generierten UI - austauschbar per Konstruktion

## Barrierefreiheit
Das strukturelle Problem ist nicht der Kontrast, sondern die Affordanz: ohne Rahmen, Schatten oder Füllung gibt es kein visuelles Signal für Klickbarkeit, weshalb interaktive Elemente mindestens einen zweiten Marker (Rahmen, Fläche, Icon) brauchen und ein sichtbarer Fokusring nicht verhandelbar ist. Der zweite Fallstrick ist Farbe als einziger Kanal - der Status muss immer auch als Text oder Form vorhanden sein, nicht nur als Kachelfarbe. Die Demo verwendet bewusst abgedunkelte Varianten der historischen Metro-Akzente (#0A6CA8 statt #1BA1E2, #0E7A5F statt #00ABA9), weil die Originalwerte weißen Text nur mit rund 2,6:1 tragen und damit unter jeder Norm liegen.

## Praxistipp
Setze genau eine Schattenstufe und genau einen Radiuswert für das ganze Produkt und halte dich daran - der Unterschied zwischen sauberem Flat 2.0 und billigem Flat ist fast immer, dass jemand eine zweite und dritte Schattenstufe eingeführt hat. Und gib jedem interaktiven Element neben der Farbe einen zweiten Marker (Fläche, 1px-Border oder Icon), sonst läuft man exakt in den Affordanz-Kollaps von 2013.

---
Quelle: https://grundhofer.github.io/designsprache/de/ — Flat Design & Flat 2.0
```
