# Investigación — Labels Naming
> Recopilado automáticamente durante la sesión del 2026-07-24 para el motor `worldgen` de Writers Hoard.


---

<!-- fuente: cartographic-typography.md -->

I've gathered primary sources. Here is the report.

---

# CARTOGRAPHIC TYPOGRAPHY CONVENTIONS — Technical Research Report

Every claim below is anchored to a URL. Where a real number does not exist in the sources, it is marked **[NO NUMBER FOUND]**.

---

## 1. FEATURE CLASS → TYPE STYLE MAPPING

### 1.1 The authoritative statement of the slant rule

The cleanest *doctrinal* statement is not in Imhof 1975 itself but in the ICA/UNGEGN self-study module on names placement (Ormeling/Tichelaar, UN Statistics Division + International Cartographic Association, July 2012), chapter 3e "Slant, case, width, underline":

> **Slant** — "roman vs italic type style"; "logically used to distinguish two major object classes: e.g. features of high relief (mountains, plateaus) vs features of low/no relief (valleys, lowlands) **or land versus water features**"; "backward italic (third option) rarely used"
>
> **Case** — "capital vs mixed case"; "suitable for hierarchical distinction (quantity)"; "**capitalized text allows smaller type**"
>
> **Letter width** — "condensed fonts require larger type size"; "suitable for hierarchical distinction (quantity)"
>
> **Line width (boldness)** — "bold - medium - bold type varieties"; "suitable for hierarchical distinction (quantity)"
>
> **Underlining** — "single or double underlining (e.g. administrative capitals)"; "suitable for distinction of order"

Source (HTML): https://unstats.un.org/unsd/geoinfo/UNGEGN/docs/_data_ICAcourses/_HtmlModules/_Selfstudy/S16/S16_03e.html
Source (PDF, same text): https://unstats.un.org/unsd/geoinfo/ungegn/docs/_data_icacourses/_pdf/selfstudy/s16/S16_03e.pdf

Note the important nuance: the canonical slant contrast is **either** high-relief vs low-relief **or** land vs water — *not* a universal "water = italic".

A blunt statement of the popular form of the rule (teaching material, UNBC GIS, 2021):

> "**Italics are reserved for hydrographic features (rivers, lakes, etc.)**" … "Underlining is not generally used"
> "**Colour (hue): nominal / qualitative .. is used associatively — Blue: hydrography, Brown: contours, Black: standard, Red: important**"

https://gis.unbc.ca/wp-content/uploads/2021/02/lettering2021.pdf

Penn State GEOG 486 states it as a soft rule:

> "Streams, rivers, and other waterlines should be labeled with text that shows their categorical difference from road features. **This is often done with italics (text posture), and/or by using a hue that matches the feature symbol.**"
> Area labels: "**Use UPPERCASE letters and stretch the label across the area of the feature.**" / "Stagger area labels for increased legibility."

https://courses.ems.psu.edu/geog486/node/557

Ordnance Survey's public cartography guide gives the *serif/sans* split rather than roman/italic:

> "serif fonts are often used for natural features such as lakes, rivers and mountain ranges" … "sans serif fonts, which are more uniform, are used for man-made features such as place names"
> "**Maps typically use type sizes between 6pt and 12pt**" … "most people can read 6pt without a problem"
> Area features: "the spacing between the letters increased so that the text is spread out across the area to show its lateral extent"

https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/text-on-maps

"Making Maps" (Univ. of Colorado Pressbooks, ch. 12 Typography):

> "Italics slants the letters to the right and **should be used to label water features whose label should also be in the color blue**"
> Areal features (oceans, forests, counties) "often use **letter spacing which is best suited for uppercase lettering**"
> "differences of less than **15%** in point size are typically not distinguished"

https://colorado.pressbooks.pub/makingmaps/chapter/typography/

### 1.2 What actually gets ALL CAPS vs Caps-and-lowercase — from a national mapping agency

swisstopo's official *Zeichenerklärung für die Landeskarten der Schweiz* (legend, Adobe InDesign 17.4, 2023-04-21) shows the type specimens directly. Rendering the legend pages gives:

**Landeskarten 1:10 000 / 1:25 000 / 1:50 000** (legend p. 4):

| Class | Specimen | Style observed |
|---|---|---|
| Gemeinde > 100 000 Einw. | **BASEL** | ALL CAPS, bold upright sans, largest |
| Gemeinde 50 000–100 000 | **LUGANO** | ALL CAPS, bold upright, one step smaller |
| Gemeinde / Ort / Ortsteil 10 000–50 000 | **VEVEY** / *Oerlikon* / *Bethlehem* | caps-upright / bold italic / light italic |
| 2 000–10 000 | **Sargans** / *Wabern* / *Loreto* | bold upright / bold italic / light italic |
| 1 000–2 000 | **Andermatt** / *Niederwangen* / Chézard | same triple |
| 100–1 000 | **Allmendingen** / *Trübbach* / Hardau | same triple |
| 50–100 | **Zwischbergen** / *Milken* / Casut | same triple |
| < 50 | Kammersrohr / Hofwil / Scherzlige | same triple, smallest |
| **Berge, Hügel** (summits) | Piz Bernina, Wildhorn, Mont Tendre, Belchenflue, Cima Pescia | **UPRIGHT**, black, 5 graded sizes |
| **Pässe** (passes) | *Passo del Bernina, Col de la Croix, Hohtürli, Tschingelpass* | **ITALIC**, black, 4 graded sizes |
| **Gebiets- und Flurnamen** | *Surselva, Kiental, Pfywald, Allmend, Grundwald, Chlistalde* | **ITALIC**, black, 6 graded sizes |
| **Flüsse, Seen, Gletscher** | *Le Léman, Saane, Lac de Joux, Greifensee, Lago Ritóm, Lej dals Chöds* | **ITALIC + BLUE**, 6 graded sizes |

**Landeskarten 1:200 000 / 1:300 000** (legend p. 9): settlements MILANO / BASEL / LUZERN (all-caps bold) → Köniz / Kerzers / Zäziwil / Gondo (caps-and-lowercase bold, shrinking); **Berge, Hügel now switch to ITALIC** (*Matterhorn, Chasseral, Kronberg, Gurten*); Pässe italic; Gebietsnamen italic; Flüsse/Seen/Gletscher italic + blue.

PDF: https://data.schweizmobil.ch/symbols_pdfs/symbols_de.pdf
Publisher landing page: https://www.swisstopo.admin.ch/de/swisstopo/publikationen.detail.publication.html/swisstopo-internet/de/publications/karto-publications/shop/symbols_de.pdf.html

So the operative Swiss rule is: **cultural/settlement = upright; all natural/terrain/hydrographic = italic; hydrography further separated by blue.** Summits are the exception at large scale (upright), which is exactly the ICA "high relief vs low/no relief" split.

### 1.3 The same mapping, encoded in production digital styles

**OpenStreetMap Carto** (`gravitystorm/openstreetmap-carto`, master @ `d99c3d1`, post-v6.0.0 2026-03-11). Italic (`@oblique-fonts` = `"Noto Sans Italic", @book-fonts`) is applied to exactly these classes:

| File:line | Feature | Style |
|---|---|---|
| `style/water.mss:391` | `waterway=river` | italic, `@water-text` `#4d80b3`, size 10 → 12 at z14 |
| `style/water.mss:420` | `waterway=stream` | italic (but `canal`, `drain`, `ditch` are **upright** `@standard-font`) |
| `style/water.mss:436` | `natural=bay`, `natural=strait` (line) | italic, size 10 → 12 at z15 |
| `style/water.mss:478` | `natural=water`, `landuse=reservoir/basin`, `waterway=dock` (area) | italic, sizes 10/12/15/19 by `way_pixels` |
| `style/water.mss:494` | `natural_bay`, `natural_strait` (point) | italic, 10 → 12 at z15 |
| `style/placenames.mss:60` | **state names** (`admin_level` state) | **italic**, size 10→15 |
| `style/placenames.mss:494` | **county names** (`admin_level=6`) | **italic** (level 5 is upright) |
| `style/amenity-points.mss:36` | `@landcover-face-name: @oblique-fonts` — all landcover/landuse area names | italic, 10/12/15 by `way_pixels` |
| `style/amenity-points.mss:2818, 2831` | aerodrome, ferry terminal | italic |
| `style/roads.mss:3392, 3832, 3855, 3882` | motorway junction refs, road `refs` | italic |

Everything else uses `@book-fonts` (Noto Sans Regular, upright). Repo: https://github.com/gravitystorm/openstreetmap-carto — key files: `style/water.mss`, `style/placenames.mss`, `style/amenity-points.mss`, `style/fonts.mss`, `style/style.mss`.

**Mapbox Streets v12** (`mapbox/mapbox-gl-styles`, `styles/streets-v12.json`, @ `cdaa4c1`, 2026-03-20) — https://github.com/mapbox/mapbox-gl-styles/blob/master/styles/streets-v12.json

| Layer | `text-font` | `text-transform` |
|---|---|---|
| `waterway-label` | `DIN Pro Italic` | none |
| `water-line-label`, `water-point-label` (ocean/sea/bay/water) | `DIN Pro Italic` | none |
| `building-entrance`, `building-number-label`, `block-number-label` | `DIN Pro Italic` | none |
| `settlement-major-label`, `settlement-minor-label` | `DIN Pro Medium` / `DIN Pro Regular` | **none** (caps-and-lowercase) |
| `settlement-subdivision-label` (suburb/neighborhood) | `DIN Pro Regular` | **uppercase** |
| `state-label` | `DIN Pro Bold` | **uppercase** |
| `country-label` | `DIN Pro Medium` | **none** |
| `continent-label` | `DIN Pro Medium` | **uppercase** |
| `natural-point-label`, `natural-line-label`, `poi-label` | `DIN Pro Medium` | none |

**OSM Bright (OpenMapTiles)** — https://github.com/openmaptiles/osm-bright-gl-style/blob/master/style.json — `waterway-name`, `water-name-lakeline`, `water-name-ocean`, `water-name-other` → `["Noto Sans Italic"]`; `place-other`, `place-state` → `Noto Sans Bold` + `text-transform: uppercase`; `place-country-*` → `Noto Sans Bold` (one variant `Noto Sans Italic`) + uppercase; `place-city/town/village` → `Noto Sans Regular`, no transform.

**Positron (OpenMapTiles/CARTO)** — https://github.com/openmaptiles/positron-gl-style/blob/master/style.json — `water_name` → `["Metropolis Medium Italic","Noto Sans Italic"]`; `place_country_other` → `Metropolis Light Italic`; **every** place layer uses `text-transform: uppercase` (a stylistic override of the classic rule).

---

## 2. USGS TOPOGRAPHIC MAP TYPE STANDARDS — ACTUAL POINT SIZES

### 2.1 The current authoritative source

**US Topo Cartographic Specifications**, USGS National Geospatial Program. This is the only USGS source that publishes per-feature font name / style / point size / RGB / halo point size / halo RGB. Index: https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications ("This page and its links replace the cartographic specifications query from the Specification Explorer web application (Spec-X)"). No version/date is stated on the index page.

Note: the **US Topo Product Standard** itself (Techniques & Methods 11-B2 v2.0, Feb 2019, https://doi.org/10.3133/tm11b2, PDF https://pubs.usgs.gov/tm/tm11b2/downloads/tm11b2_v2.pdf) explicitly **defers** type specs: *"Symbology and type specifications for feature content … will be published separately"* and *"The details of content, symbology, and labeling are outside the scope of this standard."* The only type number inside it is: **USNG grid labels in Trebuchet MS 12-point**.

### 2.2 HYDROGRAPHY

https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-hydrography

| Feature | Font | Style | Size (pt) | Color R/G/B | Halo (pt) | Halo RGB |
|---|---|---|---|---|---|---|
| SeaOcean | Charis SIL | **Bold Italic** | **12.00** | 101/137/191 | 0.60 | 240/240/240 |
| BayInlet | Charis SIL | **Italic** | **9.00** | 101/137/191 | 0.70 | 240/240/240 |
| StreamRiver (perennial & intermittent) | Charis SIL | **Italic** | **9.00** | 101/137/191 | 0.80 | 240/240/240 |
| CanalDitch | Charis SIL | **Italic** | 9.00 | 101/137/191 | 0.80 | 240/240/240 |
| Artificial Path | Charis SIL | Italic | 9.00 | 101/137/191 | 0.80 | 240/240/240 |
| Pipeline (aqueduct/general) | Charis SIL | Italic | 9.00 | 101/137/191 | 0.80 | 240/240/240 |
| Rapids | Charis SIL | **Italic** | **7.00** | 101/137/191 | 0.70 | 240/240/240 |

**This is the hard evidence for the hydrography-italic rule in a current national standard: 100% of named hydrographic features are italic, all in blue 101/137/191.**

### 2.3 GEOGRAPHIC NAMES (landforms)

https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-geographic-names

| Feature (FCode) | Font | Style | Size | Color | Halo | Halo RGB |
|---|---|---|---|---|---|---|
| Valley (15050) | Segoe UI | **Italic** | 9.00 | 0/0/0 | 0.70 | 240/240/240 |
| Summit (15048) | Segoe UI | **Italic** | 9.00 | 0/0/0 | 0.70 | 240/240/240 |
| Arroyo, Range, Ridge | — | — | — | — | — | "Features Not Symbolized" |

Placement text for Valley: *"Place straight inside the polygon. Placed horizontal, outside of polygon, if there isn't enough room inside the polygon or if there are too many data conflicts in or around the polygon."* Summit: *"Regular placement. Horizontal within the polygon."*

**Important**: there is **NO population→point-size table on the US Topo geographic-names page**. Populated-place labels are not specified there. **[NO NUMBER FOUND]** for a USGS city-population-to-point-size ladder.

### 2.4 GOVERNMENT UNITS (boundaries / areal features)

https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-government-units

| Feature | Font | Style | Size (pt) | Color | Halo (pt) | Halo RGB | Placement |
|---|---|---|---|---|---|---|---|
| International Boundary | Charis SIL | Bold | 9.00 | 0/0/0 | 1.00 | 240/240/240 | along polygon boundary |
| State or equivalent | Charis SIL | Regular | 8.00 | 0/0/0 | 1.00 | 240/240/240 | along polygon boundary |
| County or equivalent | Charis SIL | Regular | 7.00 | 0/0/0 | 1.00 | **255/250/177 (yellow)** | along polygon boundary |
| Forest Service / Park / Wildlife | Charis SIL | Bold | 10.00 | 67/138/56 (green) | 1.00 | 240/240/240 | horizontal within polygon |
| National Monument | Charis SIL | Bold | 10.00 | 112/77/58 (brown) | 1.00 | 240/240/240 | horizontal within polygon |
| Wilderness | Charis SIL | Bold | 10.00 | 112/77/58 | 1.00 | 240/240/240 | horizontal within polygon |
| Military / National Cemetery | Charis SIL | Regular | 10.00 | 76/103/143 | 1.00 | 240/240/240 | horizontal within polygon |
| Wild and Scenic Rivers | Charis SIL | Bold | 9.00 | 101/137/191 | 0.80 | 240/240/240 | horizontal, offset from polygon |
| PLSS Section | Segoe UI | Regular | 10.00 | 204/32/48 (red) | 1.00 | 240/240/240 | horizontal within polygon |
| PLSS Township/Range | Segoe UI | Bold | **12.00** | 204/32/48 | 1.00 | 240/240/240 | horizontal within polygon |

**No letter-spacing / character-spacing value is specified anywhere in the US Topo specs. [NO NUMBER FOUND]**

Also note: US Topo uses **two typeface families as a physical/cultural split** — **Charis SIL (serif)** for hydrography and administrative/land-status areas; **Segoe UI (sans)** for landforms, transportation, structures, PLSS, contours.

### 2.5 ELEVATION (contours)

https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-elevation

| Feature | Font | Style | Size | Color | Halo | Halo RGB | Placement |
|---|---|---|---|---|---|---|---|
| Index contour | Segoe UI | **Italic** | **6.00** | 131/66/37 (brown) | 0.70 | 240/240/240 | "Regular placement straight and centered on line" |
| Intermediate contour | Segoe UI | **Italic** | **6.00** | 131/66/37 | 0.70 | 240/240/240 | same |

### 2.6 TRANSPORTATION

https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-transportation

| Feature | Font | Style | Size (pt) | Color | Halo (pt) | Halo RGB | Placement |
|---|---|---|---|---|---|---|---|
| Runway | Segoe UI | Regular | 8.00 | 0/0/0 | 0.70 | 240/240/240 | horizontal, offset from polygon |
| Secondary Highway | Segoe UI | Regular | 7.00 | 0/0/0 | 1.00 | 240/240/240 | curved, offset from line |
| Local Connecting Road | Segoe UI | Regular | 7.00 | 0/0/0 | 1.00 | 240/240/240 | curved, offset from line |
| **Local Road** | Segoe UI | **Italic** | **6.00** | 0/0/0 | 1.00 | 240/240/240 | curved, offset from line |
| **Ferry Route** | Segoe UI | **Italic** | **6.00** | 0/0/0 | 1.00 | 240/240/240 | curved, offset from line |
| Interstate Route shield | Segoe UI | Regular | 7.00 | 255/255/255 | none | — | horizontal, centered on line |
| US Route / State Route shield | Segoe UI | Regular | 7.00 | 0/0/0 | none | — | horizontal, centered on line |
| Snow Trail | Segoe UI | Regular | 7.00 | 124/81/173 | 0.80 | 240/240/240 | curved, offset from line |
| Standard/Terra Trail | Segoe UI | Regular | 7.00 | 176/82/33 | 0.80 | 240/240/240 | curved, offset from line |
| Water Trail | Segoe UI | Regular | 7.00 | 156/156/156 | 0.80 | 240/240/240 | curved, offset from line |
| Forest Service primary route | Segoe UI | Regular | **5.00** | 0/0/0 | none | — | centered on point |
| Forest Service secondary / high-clearance route | Segoe UI | Regular | **5.25** | 0/0/0 | none | — | centered on point |

### 2.7 STRUCTURES

https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-structures — Cemetery, College/University, Court House annotations: **Segoe UI, 7.00 pt, 0/0/0, halo 0.70 pt at 240/240/240.** (The page 403s to some clients; retrieved via a rendering fetch.)

### 2.8 Resulting USGS US Topo point-size ladder (real numbers)

**5.00 / 5.25 / 6.00 / 7.00 / 8.00 / 9.00 / 10.00 / 12.00 pt** — 8 discrete steps, ratio between adjacent steps ≈ 1.05–1.20 (5.00→5.25 = 1.05; 6→7 = 1.167; 7→8 = 1.143; 8→9 = 1.125; 9→10 = 1.111; 10→12 = 1.20).

### 2.9 Legacy USGS

- **USGS Topographic Map Symbols** booklet (GIP): https://pubs.usgs.gov/gip/TopographicMapSymbols/topomapsymbols.pdf — contains the colour doctrine but **no point sizes**: "topographic contours (brown); lakes, streams, irrigation ditches, and other hydrographic features (blue); land grids and important roads (red); and other roads and trails, railroads, boundaries, and other cultural features (black)… **Names of places and features are shown in a color corresponding to the type of feature.**" Publication record: https://pubs.usgs.gov/publication/70039164
- **Historic typefaces**: Guidero (ICC 2013), "Typography in the US Topo Redesign" — "Since the 1970s, the map series used only two typefaces: **ITC Souvenir in Light and Demi weights for place names and hydrological features, and Univers in 55 and 56 weights for point features and roads**"; the redesign team "advocated replacing ITC Souvenir Light/Demi with **Georgia**, and Univers 55/56 with **Trebuchet MS**." PDF: https://icaci.org/files/documents/ICC_proceedings/ICC2013/_extendedAbstract/394_proceeding.pdf (Note: the *current* published specs use Charis SIL + Segoe UI, i.e. the Georgia/Trebuchet plan was superseded except for the grid labels, which are still Trebuchet MS 12 pt per TM 11-B2.)

---

## 3. SIZE HIERARCHY — RATIOS AND LADDERS

### 3.1 The authoritative ratio theory: ETH Zürich Kartographisches Institut, 1971

*Grundlagen zur Kartenbeschriftung mit serifenloser Linear-Antiqua*, Kartographisches Institut, ETH Zürich, 1971 — distributed by GITTA: http://gitta.info/LayoutDesign/en/multimedia/Grundlagen_zur_Kartenbeschriftung.pdf (linked from http://gitta.info/LayoutDesign/en/html/TypogrDesign_learningObject3.html)

Verified against the page images (pp. 6/10, 7/10, 8/10, 9/10):

**Grading factor q (ratio between adjacent hierarchy levels):**
- "Untersuchungen ergeben, dass zum mühelosen Ordnen der Schriften nach Versalhöhe **der Faktor q grösser als etwa 1.15** sein muss. Für trennende Abstufungen **muss q mindestens 1.4** sein."
  → **q > ~1.15 to be orderable by eye; q ≥ 1.4 for a genuinely separating step.**
- Titles/legend: "beschränkt man sich … auf zwei oder drei Schriftgrade, welche ungefähr nach dem **Goldenen Schnitt (q = 1.62)** abgestuft sind. Der Faktor q muss mindestens **1.5** sein."
- DIN 16 / DIN 17 Vorzugsreihe 1 for technical drawing: **a = 1.8 mm, q = √2 = 1.41**; normed cap heights **1.8, 2.5, 3.5, 5, 7, 10, 14, 20 mm**.
- **Settlement names**: "Sie werden meist in **vier bis acht Klassen** eingeteilt. **Der Faktor q liegt im Bereich 1.2 … 1.3**, abhängig vom Kartentyp, Kartenmasstab und Klassenzahl. In guten Abstufungen ist **der grösste verwendete Schriftgrad nicht mehr als doppelt so gross wie der kleinste**. Dies bedeutet, dass durch Variation des Schriftgrades allein **nur drei oder vier Klassen** gebildet werden können. Deshalb wird bei Abstufungen von Siedlungsnamen ausser dem Schriftgrad teilweise noch Schriftstärke, Schriftform, Schriftbreite und Schreibart variiert."
  → **This is the numeric justification for the whole ladder: ~1.2–1.3× per step, max range 2:1, so ≤4 levels by size alone; beyond that you must add weight/case/slant/width.**
- Master ladder: built from **a = 1.00 mm, q = ¹²√2 = 1.059**, 40 steps (n = 0…39) from 1.00 mm / 3.8 pt to 9.55 mm / 36 pt; "Damit können gröbere Abstufungen mit den Faktoren **1.12 1.19 1.26 1.33 1.41** usw. abgeleitet werden."

**Minimum sizes (formula, not just a number):**
- `minimale Versalhöhe in mm = (Sichtweite in mm + 250) / Sichtweitenfaktor`
- Sichtweitenfaktoren for easy legibility at medium light: **310 for narrow (schmal) type, 370 for normal-width type**.
- At 120 mm viewing distance → **1.2 mm cap height (narrow), 1.0 mm (normal width)**. "Die Lesbarkeitsgrenze liegt noch ungefähr **30 %** tiefer."
- "**Nach Möglichkeit sollen für Kartenschriften 1.5 bzw. 1.3 mm nicht unterschritten werden.**"

**Unit conversions given:** 1 Didot-Punkt = **0.376 mm**; 1 m = 2660 Didot-Punkt; 1 Cicero = 12 Punkt = 4.51 mm; 1 Pica-Point = **0.351 mm**; 1 m = 2849 Pica-Points. **Versalhöhe ≈ 70 % der Kegelstärke**; `Versalhöhe (mm) = Didot-Punkte × 0.265`. Cap-height : x-height ratio ≈ **1.6 (golden section)** for classical faces and Futura, **≈ 1.4** for Akzidenz-Grotesk / Gerstner / Helvetica / Univers.

**Weight limit:** "Man beschränke sich auf **höchstens drei signifikant verschiedene Schriftstärken**, entweder mager, normal und halbfett, oder eventuell normal, halbfett und fett."

**All-caps cost:** "Versalschriften sind ungefähr **30 % länger** als gemeine Schriften im gleichen Grad."

### 3.2 Imhof's own minimum type-size table (by map scale)

Imhof, *Cartographic Relief Presentation* (Steward ed.), section 9d "Minimum type sizes for sheet maps" (full scan): https://ia902900.us.archive.org/6/items/in.ernet.dli.2015.119840/2015.119840.Cartographic-Relief-Presentation_text.pdf

| Scale | Minimum height (mm) | Typographic designation |
|---|---|---|
| 1:5 000 – 1:10 000 | 1.2 mm | **3.2 point** |
| 1:25 000 | 1.1 mm | **2.9 point** |
| 1:50 000 | 1.0 mm | **2.7 point** |
| 1:100 000 | 0.8–1.0 mm | **2.1–2.7 point** |
| smaller than 1:100 000 | 0.8–1.0 mm | **2.1–2.7 point** |

Plus, verbatim from the same page:
- "For one and the same height, **upright lettering appears somewhat smaller than italic script**."
- "Lettering styles for **wall maps are, as a rule, two and one half to four times as large** as those used in sheet maps."
- On numerals: "Recently, in places, it has become conventional to show **peaks with spot heights in upright letters and other points in italic**. This practice is strongly recommended for small-scale maps…"
- "**Black, or near black, is used generally as it is most legible — and this applies to the whole field of map lettering.**"
- Spot-height positioning: "The distance from the point to the nearest digit in the figure should be **two digit widths at most**"; "the spot height of a mountain peak always has priority of position over the name of the peak."
- He explicitly argues for a *graded* rather than uniform size for spot heights (Figures 40 vs 41).

### 3.3 Modern minimum-size guidance (screen and print)

Esri, "Guidelines for minimum size for text and symbols on maps": https://www.esri.com/arcgis-blog/products/product/mapping/guidelines-for-minimum-size-for-text-and-symbols-on-maps
- Print: "**any type on a printed map should not be smaller than 5 pts**"
- Differentiation: **2-point minimum difference for sizes 5–15 pt; 15–25 % difference above 15 pt**
- Web/screen: "type should be at least **10 pixels high (capital height)**"; Windows minimum **7 pt**, Macintosh minimum **9 pt**
- Projected: at 32 ft (10 m), type ≥ 1 inch high ≈ **144 pt**
- Symbols: "the minimum sizes for symbols are about **two thirds** of the recommended text sizes"

MnIT Map Design Accessibility Quick Card: https://mn.gov/mnit/assets/MapDesignQuickCard_tcm38-375674.pdf
- "Descriptive text has a **min. font size of 12pt**. **Labels have a min. font size of 6pt**."
- Contrast: normal text 4.5:1; large text (≥ **14 pt bold or 18 pt**) 3:1; non-text elements 3:1
- Line weights should differ by at least **1 pt** (highways 3 pt, major roads 2 pt, local roads 1 pt); "**limit to no more than six**" line styles

UNBC map-lettering deck: https://gis.unbc.ca/wp-content/uploads/2021/02/lettering2021.pdf — "**minimum size = 6 points**"; "72 points ≈ 1 inch"; UPPER CASE "is (**13 %**) less readable than lower case due to the extra information provided by 'ascenders' and 'descenders'".

### 3.4 Real size ladders from production styles

**OpenStreetMap Carto** (px, `text-size`):

| Class | Ladder | Ratio |
|---|---|---|
| Country names | 10 (z3) → 11 (z4) → 12 (z5) → 13 (z7) → 14 (z9) → 15 (z10) | 1.10, 1.09, 1.083, 1.077, 1.071 |
| State names | 10 → 11 (z7) → 12 (z9) → 13 (z10) → 15 (z12) | 1.10 … 1.154 |
| Capital names | shield 11 → 12 (z6); text 13 (z8) → 14 (z10) → 15 (z11) | ~1.08 |
| Cities (`score ≥ 400 000`) | 11/12 shield → 13 (z8) → 14 (z10) → 15 (z11) | ~1.08 |
| Towns | 10 (z8) → 12 (z9) → 13 (z10) → 14 (z11) → 15 (z14) | 1.20 then 1.08 |
| Villages | 10 (z12) → 11 → 13 → 14 → 15 | 1.10, 1.18, 1.08, 1.07 |
| Hamlets | 10 (z14) → 11 → 12 | 1.10, 1.09 |
| Water areas (by `way_pixels`) | **10 → 12 → 15 → 19** at thresholds 3 000 / 12 000 / 48 000 / 192 000 px² | **1.20, 1.25, 1.267** |
| Landcover areas | **10 → 12 → 15** (`@landcover-font-size` / `-big` / `-bigger`) | 1.20, 1.25 |
| Road refs (minor) | 8 (z15) → 9 (z16) → 11 (z17) | 1.125, 1.22 |

Notice the water/landcover ladder **10 / 12 / 15 / 19** sits almost exactly on q ≈ 1.25 — inside the ETH "trennende Abstufung" band. Files: `style/placenames.mss`, `style/water.mss`, `style/amenity-points.mss` in https://github.com/gravitystorm/openstreetmap-carto

**Mapbox Streets v12** — the water label size is an explicit **rank-based formula**, not a step table:

```json
"text-size": ["interpolate",["linear"],["zoom"],
   0,  ["*", ["-", 16, ["sqrt", ["get","sizerank"]]], 1],
  22,  ["*", ["-", 22, ["sqrt", ["get","sizerank"]]], 1]]
```
i.e. **size = 16 − √(sizerank)** at z0 and **22 − √(sizerank)** at z22, for both `water-line-label` and `water-point-label`. `sizerank` is documented 0–16, "The largest objects sizerank=0 and assigns points sizerank=16" — https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/

Settlement sizes are `symbolrank` step functions (symbolrank documented 1–19):
- `settlement-major-label`: z3 → step(symbolrank): 13, at 6 → 11; z6 → 18, at 6 → 16, at 7 → 14; z8 → 20, at 9 → 16, at 10 → 14; z15 → 24, at 9 → 20, at 12 → 16, at 15 → 14
- `settlement-minor-label`: z3 → 11, at 9 → 10; z6 → 14, at 9 → 12, at 12 → 10; z8 → 16, at 9 → 14, at 12 → 12, at 15 → 10; z13 → 22, at 9 → 20, at 12 → 16, at 15 → 14
- `state-label`: z4 → 9, at 6 → 8, at 7 → 7; z9 → 21, at 6 → 16, at 7 → 14
- `country-label`: z1 → 11, at 4 → 9, at 5 → 8; z9 → 22, at 4 → 19, at 5 → 17
- `continent-label`: `["interpolate",["exponential",0.5],["zoom"], 0,10, 2.5,15]`
- `road-intersection`: `["interpolate",["exponential",**1.2**],["zoom"],15,9,18,12]` — an explicit 1.2 exponential base

Mapbox does **not** publish a symbolrank→population table. **[NO NUMBER FOUND]** for that mapping.

**OSM Bright** uses `{"base": 1.2, "stops": …}` zoom interpolation on every place layer — the classic **1.2 typographic scale ratio** used as the zoom base:
- `place-village` 12 (z10) → 22 (z15); `place-town` 14 → 24; `place-city` 14 (z7) → 24 (z11); `place-state`/`place-other` 10 (z12) → 14 (z15); `place-country-*` 11 → 17; `place-continent` fixed 14. https://github.com/openmaptiles/osm-bright-gl-style/blob/master/style.json

**Positron**: `place_country_major` `{"base": 1.4, "stops":[[0,10],[3,12],[4,14]]}`; capitals/large cities 14; all other places 10; water 12; roads 10. https://github.com/openmaptiles/positron-gl-style/blob/master/style.json

### 3.5 Population → type-class mapping used by a real national series

swisstopo legend (https://data.schweizmobil.ch/symbols_pdfs/symbols_de.pdf):

| Landeskarte 1:10k/25k/50k | Landeskarte 1:200k/300k | Landeskarte 1:500k | Landeskarte 1:1M |
|---|---|---|---|
| > 100 000 → BASEL (caps) | > 100 000 → BASEL | > 1 000 000 → MILANO | > 1 000 000 → MILANO |
| 50 000–100 000 → LUGANO | 50 000–100 000 → LUGANO | 100 000–1 000 000 → BASEL | 100 000–1 000 000 → Basel |
| 10 000–50 000 → VEVEY/Oerlikon/Bethlehem | 10 000–50 000 → VEVEY/Oerlikon/Bethlehem | 50 000–100 000 → LUZERN | 50 000–100 000 → Luzern |
| 2 000–10 000 → Sargans/Wabern/Loreto | 2 000–10 000 → Sargans/Wabern/Loreto | 10 000–50 000 → Köniz | 10 000–50 000 → Köniz |
| 1 000–2 000 → Andermatt/Niederwangen/Chézard | 1 000–2 000 → Salgesch/Niederwangen/Merlach | 2 000–10 000 → Kerzers | 2 000–10 000 → Kerzers |
| 100–1 000; 50–100; < 50 → 3 more tiers | — | 100–2 000 → Zäziwil; < 100 → Gondo | < 2 000 → Linthal |

**8 population classes × 3 administrative-status styles at large scale** — a live demonstration of the ETH rule that size alone can only carry 3–4 classes.

**OpenStreetMap Carto's population→prominence formula** (`project.mml`, `placenames-medium` datasource):

```sql
score = (CASE WHEN tags->'population' ~ '^[0-9]{1,8}$' THEN (tags->'population')::INTEGER
              WHEN place='city' THEN 100000
              WHEN place='town' THEN 1000
              ELSE 1 END)
        * (CASE WHEN tags @> 'capital=>4' THEN 2 ELSE 1 END)
```
Thresholds used in `style/placenames.mss`: `score >= 3 000 000` (z4–5), `score >= 400 000` (z5–8 shield, z8+ text), `score >= 70 000` (z6–8). https://github.com/gravitystorm/openstreetmap-carto/blob/master/project.mml

### 3.6 Name density (Swiss figures — how many labels the size budget must fit)

*Namendichte* handout via GITTA: http://gitta.info/LayoutDesign/en/multimedia/Name_Density.pdf

| Product | Names / dm² | Min. type size |
|---|---|---|
| Weltatlanten | up to **500** | **0.9 mm** |
| Schulatlanten | **150** | **1.2 mm** |
| Landeskarte 1:200 000 | **120** | **1.1 mm** |
| Landeskarte 1:100 000 | **80** | **1.0 mm** |
| Landeskarte 1:25 000 | **80** | **1.2 mm** |

---

## 4. HALO / TEXT BUFFER / CASING

### 4.1 Mapbox GL Style Spec — exact values, quoted from the reference JSON

Source of truth: `mapbox/mapbox-gl-js` → `src/style-spec/reference/v8.json` (https://github.com/mapbox/mapbox-gl-js/blob/main/src/style-spec/reference/v8.json). Rendered docs: https://docs.mapbox.com/style-spec/reference/layers/

| Property | Type | Default | Minimum | Units | Doc string (verbatim) |
|---|---|---|---|---|---|
| `text-halo-width` | number, paint, data-driven, transitionable | **`0`** | **`0`** | **pixels** | **"Distance of halo to the font outline. Max text halo width is 1/4 of the font-size."** |
| `text-halo-color` | color, paint, data-driven, transitionable | **`"rgba(0, 0, 0, 0)"`** | — | — | "The color of the text's halo, which helps it stand out from backgrounds." |
| `text-halo-blur` | number, paint, data-driven, transitionable | **`0`** | **`0`** | **pixels** | "The halo's fadeout distance towards the outside." |
| `text-size` | number, layout | **`16`** | `0` | pixels | "Font size." |
| `text-letter-spacing` | number, layout | **`0`** | — | **ems** | "Text tracking amount." |
| `text-line-height` | number, layout | **`1.2`** | — | ems | "Text leading value for multi-line text." |
| `text-max-width` | number, layout | **`10`** | 0 | ems | "The maximum line width for text wrapping." |
| `text-padding` | number, layout | **`2`** | 0 | pixels | "Size of the additional area around the text bounding box used for detecting symbol collisions." |
| `icon-halo-width` | number, paint | `0` | `0` | pixels | (Mapbox docs: creates outline around icon graphics) |
| `text-translate` | array, paint | `[0, 0]` | — | pixels | "The geometry's offset. Values are [x, y] where negatives indicate left and up, respectively." |
| `symbol-spacing` | number, layout | `250` | 1 | pixels | "Distance between two symbol anchors." |

**The documented maximum**: `text-halo-width` is capped at **¼ of `text-size`**. So at `text-size: 16` (the default) the maximum meaningful halo is **4 px**.

### 4.2 MapLibre equivalent — identical, but the range is stated explicitly

`maplibre/maplibre-style-spec` → `src/reference/v8.json` (https://github.com/maplibre/maplibre-style-spec/blob/main/src/reference/v8.json). Doc string is byte-identical: *"Distance of halo to the font outline. Max text halo width is 1/4 of the font-size."*

MapLibre's rendered docs page (https://maplibre.org/maplibre-style-spec/layers/) states the range directly:

> `text-halo-width`: *"Optional number in range `[0, 1/4 of the associated text-size]`. Units in pixels. Defaults to `0`."*

Discrepancy worth flagging for implementation: the MapLibre docs page renders `text-size` as *"in range [1, ∞), defaults to 16"*, while the reference JSON in the repo says `"minimum": 0`. Use `minimum: 0` from the JSON, or clamp at 1 to match the docs.

Related implementation constant: MapLibre's glyph SDF border is `GLYPH_PBF_BORDER = 3` px (`src/style/parse_glyph_pbf.ts`, https://github.com/maplibre/maplibre-gl-js/blob/main/src/style/parse_glyph_pbf.ts) — the physical reason a halo can't grow arbitrarily on a 24-px SDF glyph raster.

`icon-halo-width` MapLibre doc adds: *"The unit is in pixels only for SDF sprites that were created with a blur radius of 8, multiplied by the display density. I.e., the radius needs to be 16 for `@2x` sprites."*

### 4.3 Real-world halo values

**OpenStreetMap Carto** (`style/style.mss`, https://github.com/gravitystorm/openstreetmap-carto/blob/master/style/style.mss):

```css
@standard-halo-radius: 1;
@standard-halo-fill: rgba(255,255,255,0.6);
```

Usage frequency across all 20 `.mss` files (counted):

| Value | Occurrences |
|---|---|
| `text-halo-radius: @standard-halo-radius` (= **1.0 px**) | **97** |
| `text-halo-radius: @standard-halo-radius * 1.5` (= **1.5 px**) | **21** |
| `shield-halo-radius: @standard-halo-radius * 1.5` | 3 |
| `× 1.4`, `× 1.3`, `× 1.25`, `× 1.2`, `× 1.1` | 1 each |
| `text-halo-radius: 1.5` (literal) | 1 |
| `text-halo-radius: 0` | 5 |

| Halo fill | Occurrences |
|---|---|
| `@standard-halo-fill` = **`rgba(255,255,255,0.6)`** | **105** |
| `white` (opaque) | 7 |
| `rgba(255, 255, 255, 0.6)` literal | 6 |
| road-colour halos (`@motorway-fill`, `@primary-fill`, `@trunk-fill`, `@secondary-fill`, `@tertiary-fill`, `@residential-fill`, `@service-fill`, `@pedestrian-fill`, `@living-street-fill`, `@raceway-fill`) | 1 each |

The distinct pattern: **1.0 px translucent-white halo everywhere; 1.5 px reserved for the place-name hierarchy** (countries, states, counties, capitals, cities, towns, villages, suburbs, quarters, hamlets, neighbourhoods, peninsulas). Water labels get only 1.0 px. Colour-matched halos are used for road shields so the label reads as sitting *inside* the casing.

Caveat: Mapnik's `text-halo-radius` is a *radius* semantically, not Mapbox's "distance to font outline"; don't port the numbers 1:1.

**Mapbox Streets v12** (https://github.com/mapbox/mapbox-gl-styles/blob/master/styles/streets-v12.json):

| Layer | `text-halo-width` | `text-halo-blur` | `text-halo-color` |
|---|---|---|---|
| `continent-label` | **1.5** | — | `hsla(20,25%,100%,0.75)` → `hsl(20,25%,100%)` (z0→z3 interpolated) |
| `country-label` | **1.25** | — | `hsla(20,25%,100%,0.75)` → `hsl(20,25%,100%)` (z2→z3) |
| `state-label` | 1 | — | `hsl(20,25%,100%)` (+ `text-opacity: 0.5`) |
| `settlement-major-label`, `settlement-minor-label` | 1 | **1** | `hsl(20,25%,100%)` |
| `settlement-subdivision-label` | 1 | 0.5 | `hsla(20,25%,100%,0.75)` |
| `road-label`, `path-pedestrian-label` | 1 | 1 | `hsl(20,25%,100%)`; motorway/trunk get `hsla(20,25%,100%,0.75)` |
| `airport-label`, `building-entrance`, `building-number-label` | 1 | — | white-ish |
| `poi-label`, `transit-label`, `natural-point-label`, `natural-line-label`, `block-number-label`, `golf-hole-label` | **0.5** | **0.5** | `hsl(20,20%,100%)` (golf: `hsl(110,65%,65%)`) |
| `waterway-label`, `water-line-label`, `water-point-label` | **not set → 0** | — | `hsla(20,17%,100%,0.5)` (inert while width = 0) |

Mapbox's own water labels ship **with no halo at all** — the halo colour is declared but `text-halo-width` is absent, so it defaults to 0. Blue-on-blue water labels rely on colour contrast alone.

**OSM Bright**: `place-country-*`, `place-continent` → **2 px, blur 1**, `rgba(255,255,255,0.8)`; `place-city/town/village/state/other` → **1.2 px**, `rgba(255,255,255,0.8)`; `waterway-name`, `water-name-*` → **1.5 px**, `rgba(255,255,255,0.7)`; POI/airport → **1 px, blur 0.5**, `#ffffff`; `highway-name-path` → **0.5 px**, `#f8f4f0`.

**Positron**: `highway_name_other` → **2 px, blur 1**, `#fff`; `place_country_*` → **1.4 px**, `rgba(236,236,234,0.7)`; everything else (`water_name`, all place layers, motorway shields) → **1 px, blur 1**, `rgb(242,243,240)`.

### 4.4 Derived halo-to-size ratios from real styles (vs. the 0.25 spec ceiling)

| Style / class | halo px | text px | ratio |
|---|---|---|---|
| Mapbox `settlement-major-label` | 1 | 14–24 | 0.042–0.071 |
| Mapbox `poi-label` | 0.5 | 12–18 | 0.028–0.042 |
| Mapbox `country-label` | 1.25 | 11–22 | 0.057–0.114 |
| Mapbox `continent-label` | 1.5 | 10–15 | **0.10–0.15** |
| OSM Carto place names | 1.5 | 10–15 | **0.10–0.15** |
| OSM Carto general labels | 1.0 | 10 | 0.10 |
| OSM Bright water | 1.5 | 14 | 0.107 |
| OSM Bright country | 2 | 11–17 | 0.118–0.182 |
| Positron country | 1.4 | 9–14 | 0.10–0.156 |
| Positron road name | 2 | 10 | **0.20** |
| **Spec maximum** | — | — | **0.25** |

**Practical band: 0.03–0.20 of font size, clustering at 0.10–0.15.** Nobody ships at the 0.25 ceiling.

### 4.5 USGS halos in print points

Same tables as §2. Pattern: halo **0.60–1.00 pt** at **RGB 240/240/240** (near-white), i.e. a halo-to-type ratio of:
- SeaOcean: 0.60 / 12.00 = **0.050**
- Contours: 0.70 / 6.00 = **0.117**
- Streams/rivers: 0.80 / 9.00 = **0.089**
- Landforms, cemeteries, POIs: 0.70 / 7.00–9.00 = **0.078–0.100**
- County boundary: 1.00 / 7.00 = **0.143** (and the only yellow halo, 255/250/177)
- Local roads / ferry: 1.00 / 6.00 = **0.167**
- Route shields: no halo

USGS's ratios land in exactly the same 0.05–0.17 band as the web styles.

### 4.6 Qualitative caution on halo overuse

Penn State GEOG 486: "you should not overuse text halos, as these can obscure the map features underneath. Nor should you overuse leader lines … this leads to a visually confusing map." https://courses.ems.psu.edu/geog486/node/557

EU Data Visualisation Guide, "Text halos": defines a halo as "an outline of text that has a different colour than the text itself" and covers subtle→strong application, but supplies **no numbers**. **[NO NUMBER FOUND]** at https://data.europa.eu/apps/data-visualisation-guide/text-halos

---

## 5. IMHOF — EXPLICIT ENUMERATED RULES

### 5.1 Imhof's own five rules, in his own words (1960, ETH Zürich)

Reproduced in full as *"Rules Concerning Word Position in Maps — Edited by Prof. Ed. Imhof, Zürich (March 1960)"*, distributed by the GITTA/CartouCHe cartography curriculum:
**http://gitta.info/LayoutDesign/en/multimedia/General_Viewpoints_and_Postulates.pdf** (linked from http://gitta.info/LayoutDesign/en/html/TypogrDesign_learningObject3.html)

> 1. **Unambiguous juxtaposition to object.** Kind and size of the type are helpful in facilitating correct positioning. Definite coordination required, therefore limitation of map contents and quantity of names.
> 2. The names must be **quickly overlooked, and found**, they have to be clearly separated and readable. Quick readability depends not only on the form of the type but also on its location and distribution.
> 3. **Least possible derangement (covering, veiling) of the map content.** Intersections should be avoided, if possible.
> 4. The word positioning should not be rigid, but fluid as to **make kinds of objects recognizable by the letter print alone**, i.e. without the remaining map image. Importance of lettering-type, size and positioning.
> 5. **The map should not be evenly filled with names.** On the other hand, name knots are to be avoided. This should be considered while selecting the names. **Light, void areas (oceans, bays, lakes, glaciers etc.) do not tolerate as heavy [lettering] as dark housing blocks, city plans etc.** (Graphic-optical arrangement).
>
> "The aesthetic postulate for pleasing, quiet and fluid effects is partly fulfilled when the five points above are given consideration."

Rule 4 is the direct authority for feature-class → type-style mapping: type must encode object class well enough that you could classify features **from the lettering alone**.

### 5.2 Imhof 1975 — the six general principles, as restated verbatim

Imhof, E. (1975), "Positioning names on maps", *The American Cartographer* 2(2):128–144. DOI landing page: https://www.tandfonline.com/doi/abs/10.1559/152304075784313304 (paywalled; the paper itself is not openly available). Semantic Scholar record: https://www.semanticscholar.org/paper/Positioning-Names-on-Maps-Imhof/15c28f672b6b6b0506e12e918c043700adf44199

The most reliable *open* restatement is Ahn & Freeman, "A Program for Automatic Name Placement", Auto-Carto 6 (1983), pp. 101–104 — **https://cartogis.org/docs/proceedings/archive/auto-carto-6/pdf/a-program-for-automatic-name-placement.pdf**:

> "According to Imhof (Imhof 1975) there are **six general principles** that should be followed in annotating a map. They are:
> 1. Names should be **easily readable and easily locatable**;
> 2. A name and the object to which it belongs should be **easily recognizable**;
> 3. **Covering, overlapping, and concealment should be avoided**;
> 4. Names should **assist directly in revealing spatial situation, territorial extent, connections, importance, and differentiation of objects**;
> 5. **Type arrangement should reflect the classification and hierarchy of objects on the map**;
> 6. Names should **not be evenly dispersed nor be densely clustered**."

The same paper's operational rule set (also citing Imhof) — this is the enumerated rule list most people are actually looking for:

**Basic rules (all feature types):**
> 1. A name should not overlap another name or a point feature. If a name does overlap a line feature (or a boundary of an area feature), **the line, not the name, should be interrupted**;
> 2. Names should not be evenly dispersed nor be densely clustered.

**Area feature rules:**
> 1. The label for an area feature should **span the entire area and conform to the general shape of the feature, leaving about one and one-half letter spaces at both ends**. However, if there is no significant difference between this placement and horizontal placement, then **preference should be given to horizontal placement**;
> 2. Non-horizontal-placed names should not be straight, but curved. **The arcs should not be greater than 60 degrees**;
> 3. A name that reads away from the horizontal is preferred over a name that reads toward the horizontal.

**Line feature rules:**
> 1. The label should conform to the curvature of the line;
> 2. Complicated and extreme curvatures should be avoided;
> 3. **Line feature labels should not be spread out**, but may be repeated at reasonable intervals along the line;
> 4. For horizontal line features, names should be placed **above** the line. For vertical line features: if the feature lies in the left half of the map, place the name on the left side reading upward; otherwise on the right side reading downward;
> 5. Avoid placing a name near an endpoint of the line feature.

**Point feature rules:**
> 1. The label should be horizontal (usually east–west) and parallel to one of the map boundaries;
> 2. Point feature labels, like line feature labels, **should not be spread out**;
> 3. Close to the point, but some specified minimum distance must be maintained;
> 4. Since English has many more ascenders than descenders, **'titles' (labels above the point) are preferred to 'signatures' (labels below)**;
> 5. "Although the best possible position of a point label is open to debate, **Imhof recommends placement somewhat above and to the right of the point** (Imhof 1975)."

Note rules **Area-1 vs Line-3 vs Point-2**: Imhof's rule is that **only area names are letterspaced**; line and point names are *not*.

Doerschler & Freeman, "An Expert System for Dense-Map Name Placement", Auto-Carto 9 (https://cartogis.org/docs/proceedings/archive/auto-carto-9/pdf/an-expert-system-for-dense-map-name-placement.pdf) confirms the same lineage — "uses rules based upon those enumerated by Imhof (Imhof 1975) to determine the **location, orientation, font, size, and slant** of each character in feature names" — but does not restate them.

### 5.3 Imhof, *Cartographic Relief Presentation* — the lettering material

Full scan (Internet Archive / DLI): https://ia902900.us.archive.org/6/items/in.ernet.dli.2015.119840/2015.119840.Cartographic-Relief-Presentation.pdf (text layer: `..._text.pdf`, same directory). Google Books record: https://books.google.com/books/about/Cartographic_Relief_Presentation.html?id=cVy1Ms43fFYC

Imhof scopes it out himself: *"It is not within the scope of this book to study the broad theme of map lettering in detail"* — the book's lettering content is concentrated in §9 on spot heights and numerals (see §3.2 above for the extractable table and rules). Also from the same book, on lettering density: *"the terrain can scarcely be recognized beneath the veil of letters … names must be undertaken with care, and the style and size of lettering must be well chosen."*

### 5.4 UNBC's restatement of Imhof's area rules (with a number)

https://gis.unbc.ca/wp-content/uploads/2021/02/lettering2021.pdf — slides explicitly captioned "Examples from Eduard Imhof":
> "Name should fit inside with **minimum 1 letter width on either side**"
> "**Space lettering if area is large, but not > 4 × letter height, evenly**"
> "**Serifs are useful in spaced names**"
> "Lettering should not be beyond the vertical … **the only exception (?) is contour lines, where lettering tops can 'point uphill' to show terrain form**"
> "And never 'just a bit off vertical' which looks like an accident"
> Lines: "Follow the orientation of the line (river, road, etc.); find a relatively straight piece to label; **label above the line, far enough away so descenders don't cross it**"
> Combinations: "**Consistency**: lettering within a class should be the same (e.g. all major rivers). **Contrast**: should be higher between major classes than within a class type. **Harmony**: avoid many type faces (fonts); use different forms instead."

---

## 6. LETTER-SPACING (TRACKING) FOR AREA NAMES — THE NUMBERS

### 6.1 The one source with hard numbers: ETH Zürich 1971

http://gitta.info/LayoutDesign/en/multimedia/Grundlagen_zur_Kartenbeschriftung.pdf, p. 9/10 "Schriftlänge / Anwendungen" (verified against the page image):

> "Wichtige Teile eines Textes können durch **Sperrdruck** optisch ausgezeichnet werden (verminderte Grauwirkung). **Sperrbetrag ungefähr 20 % der Versalhöhe.**"
>
> "**Namen, welche sich auf Flächen oder Linien beziehen, werden meist gesperrt geschrieben, um eine Dimension auch in der Beschriftung anzudeuten. Beispiele: Namen von Ländern, Landschaften, Tälern, Gletschern, Seen, Berggräten usw.**"
>
> "**Umstritten ist das starke Sperren von Flussnamen.**" ("Strong letterspacing of river names is controversial.")
>
> "**Minimaler Sperrbetrag etwa 20 % der Versalhöhe.**"
>
> "**Maximaler Sperrbetrag**: Schriften auf stark belegtem Hintergrund werden mühsamer lesbar, wenn sie auf **mehr als dreifache Länge** erweitert werden. Der Sperrbetrag ist dann etwa **grösser als 120 % der Versalhöhe für gemeine Schrift, und grösser als etwa 160 % für Versalschrift.**"
>
> "**Versalschriften müssen grundsätzlich leicht spationiert werden. Sperrbetrag mindestens 5–10 % der Versalhöhe**, für fette Schriften eher weniger, für magere eher mehr." (Shown as a specimen ladder: 0 % / 3 % / 5 % / 7 % / 10 % EDMONTON.)
>
> "Man beachte, dass bei kräftig spationierten Schriften **die Schriftstärke scheinbar abnimmt**. Mit fein abgestuften Stärken könnte dieser Effekt kompensiert werden."
>
> Also p. 5/10: "**Serifenlose Linear-Antiquaschriften sollten in Karten fast ausnahmslos zumindest leicht gesperrt werden**, was zu oft unterlassen wird."

**Conversion to em units** (using the same document's `Versalhöhe ≈ 0.70 × Kegelstärke`):

| ETH rule | % of cap height | ≈ em (of body size) |
|---|---|---|
| Caps, minimum obligatory tracking | 5–10 % | **0.035–0.07 em** |
| Emphasis (Sperrdruck) | ~20 % | **~0.14 em** |
| Area/line names, minimum | ~20 % | **~0.14 em** |
| Area names, practical maximum (lowercase) | ~120 % | **~0.84 em** |
| Area names, practical maximum (caps) | ~160 % | **~1.12 em** |
| Absolute limit (total set width) | ≤ 3× unspaced length | — |

### 6.2 Real em values shipped in production styles

**Mapbox Streets v12** `text-letter-spacing` (units: **ems**):

| Layer | Value |
|---|---|
| `water-line-label` / `water-point-label`, class = **ocean** | **0.25 em** |
| `water-line-label` / `water-point-label`, class = **sea** or **bay** | **0.15 em** |
| `water-point-label`, other water | 0.01 em |
| `state-label` | **0.15 em** (+ `text-transform: uppercase`) |
| `settlement-subdivision-label`, type = **suburb** | **0.15 em** (+ uppercase) |
| `settlement-subdivision-label`, other (neighborhood) | **0.05 em** (+ uppercase) |
| `continent-label` | **0.05 em** (+ uppercase) |
| `road-number-shield` | 0.05 em |
| `road-label`, `path-pedestrian-label`, `ferry-aerialway-label`, `transit-label`, `airport-label` | 0.01 em |
| `country-label`, `settlement-major/minor-label` | **not set → 0** |

So Mapbox's canonical "spread across the ocean" tracking is **0.25 em ≈ 36 % of cap height** — comfortably inside the ETH 20 %–120 % band.

**OSM Bright**: `waterway-name`, `water-name-lakeline`, `water-name-ocean`, `water-name-other` → **0.2 em**; `place-other`, `place-state` → **0.1 em** (both uppercase).

**OSM Carto**: exactly **one** letterspacing declaration in the whole style — `style/placenames.mss:47`, on `#country-names`: `text-character-spacing: 0.5` (Mapnik units = px). At `text-size` 10–15 px that is **0.033–0.05 em**. Countries are the only class OSM Carto tracks out.

**Positron**: **no** `text-letter-spacing` anywhere. **[NO NUMBER FOUND]**.

**USGS US Topo**: no character-spacing spec on any page. **[NO NUMBER FOUND]**.

### 6.3 Qualitative doctrine on where tracking is allowed

ICA/UNGEGN S16 chapter 3d, "Line- and letterspacing" — https://unstats.un.org/unsd/geoinfo/ungegn/docs/_data_icacourses/_pdf/selfstudy/s16/S16_03d.pdf:
> "Spacing may be appropriate for area features"
> "**Optional for visually bounded areas (islands, countries)**" — example: "The text 'Sulawesi' should be spaced out from the gridlines (S u l a w e s i)"
> "**Mandatory for larger objects without visible boundaries**" — example: Aceh
> "In combination with plastic [curved] name placement. **If not plastic, fixed kerning is preferable.**"
> **Preconditions**: "the named object should be an area feature"; "in case of non-plastic name placement, the name should fit inside the boundaries of the named object"

No numeric values in the ICA module. **[NO NUMBER FOUND]** there.

Size guidance from the same module (chapter 3b, https://unstats.un.org/unsd/geoinfo/ungegn/docs/_data_icacourses/_pdf/selfstudy/s16/S16_03b.pdf) is also purely qualitative: "Fixed size classes are easier to recognize"; "Use a **limited number of fixed and distinct type sizes** — otherwise the advantage of easier recognition is lost"; "Size represents hierarchy." **[NO NUMBER FOUND]**.

---

## 7. SWISS / SWISSTOPO CONVENTIONS — CONSOLIDATED

Primary sources:
- **swisstopo, *Zeichenerklärung für die Landeskarten der Schweiz* (1:10 000 – 1:1 Million)**, 2023: https://data.schweizmobil.ch/symbols_pdfs/symbols_de.pdf · publisher page https://www.swisstopo.admin.ch/de/swisstopo/publikationen.detail.publication.html/swisstopo-internet/de/publications/karto-publications/shop/symbols_de.pdf.html
- **Kartographisches Institut ETH Zürich, *Grundlagen zur Kartenbeschriftung mit serifenloser Linear-Antiqua*, 1971**: http://gitta.info/LayoutDesign/en/multimedia/Grundlagen_zur_Kartenbeschriftung.pdf
- **Imhof, *Rules Concerning Word Position in Maps*, 1960**: http://gitta.info/LayoutDesign/en/multimedia/General_Viewpoints_and_Postulates.pdf
- **Namendichte** table: http://gitta.info/LayoutDesign/en/multimedia/Name_Density.pdf
- **Placing Type on Streetmaps** (from *Ausbildungsleitfaden Kartograph/in* 1995): http://gitta.info/LayoutDesign/en/multimedia/Placing_Type_on_Streetmaps.pdf

Key Swiss-specific doctrine, verbatim from ETH 1971:

**Slant (Schriftlage):**
> "Die Variable Schriftlage dient dazu, **artverschiedene Objektgruppen** in der Schrift zu differenzieren."
> "**Stehende Schriften sollen im allgemeinen immer überwiegen.** Als trennende Variable kann die Schriftlage nur dann angesehen werden, wenn **die Kursiv mindestens 75° geneigt ist**." (i.e. ≥ 15° off vertical, otherwise the italic doesn't read as a separate class.)
> "**Von rückwärtsliegenden Schriften, wie sie in deutschen Karten für Gewässernamen üblich sind, wird abgeraten. Gewässernamen werden am besten durch Blaudruck charakterisiert.**"
> Measured slant angles of contemporary faces: **Futura 82°, Gerstner-Programm 78°, Univers 73°, Venus 71°.**

**Colour (Schriftfarbe):**
> "Mehrfarbige Karte – Zweifarbige Schriften. **Meist Schwarz plus Blau für Gewässernamen.** Erfordert kräftiges Blau. Auflockerung des Schriftbildes. **Oft verwendet.**"

**Case (Schreibart):**
> "**Versalschrift wird für die wichtigsten, meist schon bekannten Namen und im Kartentitel verwendet. Sie muss in Karten immer leicht spationiert werden.** Versalschriften sind ungefähr 30 % länger als gemeine Schriften im gleichen Grad. **Gemeine Schrift ist leichter lesbar und muss immer mengenmässig weit überwiegen.**"
> Kapitälchen (small caps): "wird gelegentlich im Kartentitel für allfällige Personennamen verwendet." — i.e. small caps has essentially **no** role in the Swiss map face itself, only in the title block.

**Width (Schriftbreite):**
> "**Normalbreite Schriften verwendet man für flächen- oder linienbezogene Namen**, für Titel, Legenden sowie Mengentext. **Schmale Schriften nimmt man für Namen, welche sich auf einen Punkt oder eine kleine Fläche beziehen** … So wächst der Anteil der schmalen Schriften mit kleinerwerdendem Masstab."
> "EDMONTON — **Schmale Versalien leicht spationiert sind viel besser lesbar als normalbreite Versalien unspationiert.**"

**Base face choice by scale:**
> 1:25 000 and 1:50 000: field/water/topographic names outnumber settlement names → the **klassizistische Antiqua of the Landestopographie** is well suited and "kann wohl kaum äquivalent durch eine serifenlose Linear-Antiquaschrift ersetzt werden."
> 1:100 000 and smaller: settlement names dominate → "**kommt nur noch eine Form der serifenlosen Linear-Antiqua in Frage**."
> Maps with reduced/absent terrain rendering (nautical, road, aeronautical, thematic): "**soll als Grundschrift nur serifenlose Linear-Antiqua verwendet werden**."
> Mixing warning: "Heikel sind Kombinationen von klassizistischer Antiqua mit serifenloser Linear-Antiqua."

**Orientation:** "**Schriften, die um mehr als 30° geneigt sind, können nur mühsam gelesen werden.** … Schräg verlaufende, freistehende Schriften wirken starr. Sie sollen zumindest leicht gebogen werden."

**Kerning:** worst caps pairs for sans-serif Linear-Antiqua requiring Versalausgleich: `AT AV AW AY LT LV LW LY VA WA / Ta Te Ti To Tr Tu`.

**Overall summary rule (ETH):**
> "Die **geometrische Artverschiedenheit** der Objekte wird mit den Variablen **Schriftbreite, Schriftlänge und Schriftverlauf** berücksichtigt. Die **Artverschiedenheit von Objektgruppen** wird mit den Variablen **Schriftart, Schriftfarbe und Schriftlage** dargestellt. Die **Wertverschiedenheit von gleichartigen Objekten** wird durch die Variablen **Schriftgrad und Schreibart** dargestellt. Die **Dominanz** wird durch verstärkte Grauwirkung mit den Variablen **Schriftstärke und Schriftfarbe** erreicht."

That last paragraph is a clean, citable four-axis spec: **geometry → width/tracking/curvature; class → family/colour/slant; value → size/case; dominance → weight/colour.**

Contextual note on Swiss typographic identity (Guidero, ICC 2013, https://icaci.org/files/documents/ICC_proceedings/ICC2013/_extendedAbstract/394_proceeding.pdf): "The singular Swiss topographic maps would likely not be as instantly recognizable if the land cover color scheme was altered and **the italicized serifs replaced by a roman humanist sans serif**."

---

## 8. GAPS — THINGS I COULD NOT FIND A REAL NUMBER FOR

1. **A USGS population→point-size table for populated places.** The US Topo Geographic Names spec covers landforms only; populated-place annotation is not published there. Only the Government Units spec assigns sizes to administrative areas.
2. **A published symbolrank→population mapping for Mapbox.** `symbolrank` is documented as an opaque 1–19 prominence value; the tileset reference gives only a prose definition of `place_label.class` ("city = about 100,000 or more people"). https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/
3. **The full text of Imhof 1975.** It is paywalled at Taylor & Francis (https://www.tandfonline.com/doi/abs/10.1559/152304075784313304); every "enumerated list" in circulation traces back to Ahn & Freeman's restatement, which I quote verbatim above. Do not cite page numbers for the six principles as if from the original.
4. **Explicit em-unit tracking values in the ICA/UNGEGN module or the USGS specs.** Both are qualitative on this point.
5. **A swisstopo *numeric* type-size table** (point sizes per feature class). The public *Zeichenerklärung* shows specimens and population classes but publishes no point/mm values; the numeric doctrine is in the 1971 ETH document, not in the current legend.
6. **Any renderer-side source confirming the ¼-of-font-size halo clamp is enforced at runtime.** The `1/4` figure appears only in the style-spec doc string (both Mapbox and MapLibre, identical wording); the related hard constraint I could verify in code is `GLYPH_PBF_BORDER = 3` in `maplibre-gl-js/src/style/parse_glyph_pbf.ts`.
7. **Line widths minima in the Esri minimum-size article** — it covers text and symbols only.

---

### Local artifacts from this research (in `/tmp`, if you want to re-inspect rather than re-download)

`/tmp/osmc/` (openstreetmap-carto clone), `/tmp/mbstyles/styles/streets-v12.json`, `/tmp/osmbright/style.json`, `/tmp/positron/style.json`, `/tmp/mbspec/src/style-spec/reference/v8.json`, `/tmp/mlspec/src/reference/v8.json`, `/tmp/imhof.pdf` + `/tmp/imhof.txt`, `/tmp/Grundlagen_zur_Kartenbeschriftung.pdf` + rendered pages `/tmp/gk-0*.png`, `/tmp/swisstopo.pdf` + rendered pages `/tmp/stx-04.png`, `/tmp/st-09.png`, `/tmp/ac6.txt` (Ahn & Freeman), `/tmp/unbc.txt`, `/tmp/ustopo_v2.pdf`, `/tmp/guidero.txt`, `/tmp/toposym.pdf`.

agentId: a24cfff7c259471c1 (use SendMessage with to: 'a24cfff7c259471c1', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 235434
tool_uses: 102
duration_ms: 1040563</usage>

---

<!-- fuente: area-label-geometry.md -->

I have everything. Writing the report.

---

# AREA-FEATURE LABEL GEOMETRY — position, angle, size from region shape

Research notes for a TS/Voronoi procedural fantasy map generator. Every claim carries a URL. Numbers I could not verify are called out explicitly. All formulas in Part 2 were validated numerically (script run results included).

---

## PART 1 — MAPBOX POLYLABEL: THE WRITTEN ALGORITHM

### 1.1 The blog post (primary source)

**URL:** https://blog.mapbox.com/a-new-algorithm-for-finding-a-visual-center-of-a-polygon-7c77e6492fbc (Vladimir Agafonkin, Mapbox, 2016-08-15, 5 min read). Medium mirror: https://medium.com/@agafonkin/a-new-algorithm-for-finding-a-visual-center-of-a-polygon-7c77e6492fbc

Note: the blog is Cloudflare-gated to plain `curl`; it is retrievable via a reader proxy (`https://r.jina.ai/<url>`) or WebFetch.

**Why centroid fails** (direct quote):

> "The first thing that comes to mind for calculating such a center is the **polygon centroid**. You can calculate polygon centroids with a simple and fast formula, but if the shape is concave or has a hole, the point can fall outside of the shape."

**Definition adopted** (direct quote):

> "A more reliable definition is the **pole of inaccessibility** or largest inscribed circle: the point within a polygon that is farthest from an edge."

**Why not exact methods** (direct quote — this is the citation you want for "medial axis is overkill"):

> "Unfortunately, calculating the pole of inaccessibility is both complex and slow. The published solutions to the problem require either **Constrained Delaunay Triangulation** or computing a **straight skeleton** as preprocessing steps — both of which are slow and error-prone."
> "For our use case, we don't need **an exact solution** — we're willing to trade some precision to get more speed. When we're placing a label on a map, it's more important for it to be computed in milliseconds than to be mathematically perfect."

**Bounding-box center is NOT discussed in the blog.** It appears only in the source, as a special case:

```js
// special case for rectangular polygons
var bboxCell = new Cell(minX + width / 2, minY + height / 2, 0, polygon);
if (bboxCell.d > bestCell.d) bestCell = bboxCell;
```
(https://cdn.jsdelivr.net/npm/polylabel@1.1.0/polylabel.js, lines 47–49). So bbox-center is used as a *second seed*, not rejected. Any "bbox center fails" claim is **not verifiable from this source**.

**The quadtree subdivision** (direct quote):

> "1. Start with a few large cells covering the polygon. 2. Recursively subdivide them into four smaller cells, probing cell centers as candidates and discarding cells that can't possibly contain a solution better than the one we already found. Since the search is exhaustive, we will eventually find a cell that's guaranteed to be within a global optimum."

**The pruning bound** (direct quote):

> "If we know the distance from the cell center to the polygon (`dist` above), any point inside the cell can't have a bigger distance to the polygon than `dist + radius`, where `radius` is the radius of the cell. If that potential cell maximum is smaller than or equal to the best distance of a cell we already processed (within a given precision), we can safely discard the cell."
> "For this assumption to work correctly for any cell regardless whether their center is inside the polygon or not, we need to use **signed** distance to polygon — positive if a point is inside the polygon and negative if it's outside."

The blog says `dist + radius`. The `sqrt(2)` you asked about is the *definition of* `radius` and appears only in the README/source:

- README: "the cell radius (equal to `cell_size * sqrt(2) / 2`)" — https://cdn.jsdelivr.net/npm/polylabel@1.1.0/README.md
- Source: `this.max = this.d + this.h * Math.SQRT2;` where `h` is *half* the cell size — so `radius = h·√2 = (cell_size/2)·√2 = cell_size·√2/2`. Consistent. This is exactly the half-diagonal of the square cell.

**Priority queue** (direct quote):

> "Instead of a breadth-first search, iteratively going from bigger cells to smaller ones, we started managing cells in a **priority queue**, sorted by the cell 'potential': `dist + radius`. This way, cells are processed in the order of their potential. This **roughly doubled the performance** of the algorithm."
> "Another speedup we can get is taking polygon centroid as the first 'best guess' so that we can discard all cells that are worse. This improves performance for relatively regular-shaped polygons."

### 1.2 The canonical 5-step algorithm (from the README, verbatim)

**URL:** https://cdn.jsdelivr.net/npm/polylabel@1.1.0/README.md (mirrors https://github.com/mapbox/polylabel)

> 1. Generate initial square cells that fully cover the polygon (with cell size equal to either width or height, whichever is lower). Calculate distance from the center of each cell to the outer polygon, using negative value if the point is outside the polygon (detected by ray-casting).
> 2. Put the cells into a priority queue sorted by the maximum potential distance from a point inside a cell, defined as a sum of the distance from the center and the cell radius (equal to `cell_size * sqrt(2) / 2`).
> 3. Calculate the distance from the centroid of the polygon and pick it as the first "best so far".
> 4. Pull out cells from the priority queue one by one. If a cell's distance is better than the current best, save it as such. Then, if the cell potentially contains a better solution that the current best (`cell_max - best_dist > precision`), split it into 4 children cells and put them in the queue.
> 5. Stop the algorithm when we have exhausted the queue and return the best cell's center as the pole of inaccessibility. It will be guaranteed to be a global optimum within the given precision.

Key structural detail worth stealing: **initial cell size = min(bbox width, bbox height)**, not max. For a 1000×200 region you start with 5 columns × 1 row of 200-unit cells, so the first level already adapts to the thin axis.

### 1.3 PRECISION — what is and isn't documented

**Documented:** "precision (`1.0` by default)" (README). Shapely's port documents it as *"`tolerance` represents the highest resolution in units of the input geometry that will be considered for a solution (default value is 1.0)"* (source below).

**NOT documented anywhere I could find:** guidance for projected vs geographic coordinates, or what happens as precision → 0. The blog does not mention the precision parameter at all beyond "within a given precision" / "until the search area is small enough for the precision we want". **Treat any "use 0.00001 for lat/lon" advice as folklore — I could not verify it from Mapbox sources.**

What is derivable from the code (`polylabel.js` lines 64–72):
- Termination test is `if (cell.max - bestCell.d <= precision) continue;`. `cell.max - bestCell.d` has units of the input coordinates. **Precision is an absolute distance in input units**, so for WGS84 degrees a precision of 1.0 means "1 degree" ≈ 111 km, i.e. effectively no refinement. For a fantasy map in SVG pixels, precision 1.0 = 1 px, which is right.
- Subdivision depth is bounded by `h_k = h_0 / 2^k`, and refinement of a cell stops once `h·√2 ≤ precision + (best − d)`. Worst case depth ≈ `log2(cellSize·√2 / precision)`. For a 1000-unit cell and precision 0.001 that is ~20 levels.
- As precision → 0 the algorithm does **not** hang: it converges to floating-point resolution, because `h` halves each level and the queue drains. It just gets slower, sub-linearly (see measurements).

### 1.4 PERFORMANCE — what is quoted, and real measured numbers

**Quoted in the blog:** "It is **up to 40 times faster** than the algorithm we started with, while also guaranteeing the correct result in all cases." and "The module is just **100 lines of code**."
**Quoted in the README:** "is many times faster (**10-40x**)".
**Also:** the priority queue "roughly **doubled** the performance"; centroid seeding "improves performance for relatively regular-shaped polygons."

**No millisecond timings, no probe counts, and no benchmark polygon description appear in either source.** Those numbers do not exist in the published material — do not cite any.

So I measured them. `polylabel@1.1.0` under Node, deterministic star-shaped blob polygons in a ~1000×600 unit box (map-pixel scale), 200 reps per timing, probe counts read from the library's own `debug` output (`num probes: N`):

| verts | precision | probes | best dist | time/call |
|---|---|---|---|---|
| 20 | 10 | 58 | 147.68 | 0.109 ms |
| 20 | 1.0 | 110 | 148.91 | 0.072 ms |
| 20 | 0.1 | 150 | 149.20 | 0.076 ms |
| 20 | 0.01 | 198 | 149.2399 | 0.066 ms |
| 20 | 0.001 | 234 | 149.2399 | 0.065 ms |
| 60 | 1.0 | 94 | 136.54 | 0.047 ms |
| 60 | 0.001 | 218 | 136.9847 | 0.112 ms |
| 200 | 1.0 | 94 | 136.92 | 0.153 ms |
| 200 | 0.1 | 254 | 137.011 | 0.382 ms |
| 200 | 0.01 | 770 | 137.021 | 1.104 ms |
| 200 | 0.001 | 1602 | 137.0212 | 2.421 ms |
| 1000 | 1.0 | 102 | 130.53 | 1.111 ms |
| 1000 | 0.001 | 206 | 130.7792 | 1.752 ms |

Readings for your generator:
- **Probe count is essentially independent of vertex count** (58–110 probes at precision ≥ 1). Cost is `O(probes × m)` where `m` = ring vertex count, because `pointToPolygonDist` is a full linear scan over every segment (`polylabel.js` lines 98–117). That is the real complexity: **O(P·m)** with P ≈ 100–1600.
- Going from precision 1.0 → 0.001 costs 2–17× more probes but buys ≤ 0.5 units of accuracy. **Precision 1.0 (one pixel) is the correct default for label placement.** Anything below 0.1 is wasted.
- A 1000-vertex region costs ~1.1 ms. For 30 states that's ~33 ms — fine at generation time, not per-frame.
- **Optimization for a Voronoi generator:** simplify the region ring before calling polylabel. Vertex count dominates; probe count doesn't.

### 1.5 Garcia-Castellanos & Lombardo 2007 — the actual paper (and a Mapbox error)

**Paper:** D. Garcia-Castellanos & U. Lombardo (2007), "Poles of inaccessibility: A calculation algorithm for the remotest places on earth", *Scottish Geographical Journal* 123(3):227–233. DOI **10.1080/14702540801897809**.
**Landing page:** https://sites.google.com/site/polesofinaccessibility/
**Free PDF (verified, 7 pages):** https://docs.google.com/uc?id=0B_xuyENh5ksFOGE1ZmU5ZjQtNjZmNi00ZTRlLWIyZGUtNmRiNDhhNzRkYTA1
**Code (as printed in the paper):** `http://cuba.ija.csic.es/~danielgc/PIA/` — ANSI C + C-shell scripts. I did not verify this URL still resolves.

Algorithm, quoted from the paper's Methodology section:

> "An iterative method is designed to calculate the PIA associated to a given coastline. For each iteration, a successively smaller region R defined by a longitude range λmin, λmax and a latitude range φmin, φmax is defined centred on a candidate PIA location λPIA, φPIA. Initially, R corresponds to the region in which the location of maximum distance to the coast is searched. A regular, rectangular grid of Nλ by Nφ nodes is then defined in R. **Most results shown in this paper use Nλ = Nφ = 21.** The distance from each of those **441 nodes** to the coastline is then calculated and a new candidate location λ'PIA, φ'PIA is defined as the node maximising such distance. Subsequently the region R is **reduced in size by a factor √2** and centred at λ'PIA, φ'PIA and the procedure is iterated. Because spherical distance is a continuous function of the location λ, φ, this algorithm ensures convergence towards a **local** maximum of the distance to the shore, but it does not ensure that it is the **absolute** maximum."

> "A total of about **80 000 geographical coordinates** are checked to calculate one PIA with a **precision of ca. 1 km**, which takes about **110 minutes** of computation time of a standard personal computer."

> "The first iterations of the algorithm are performed using Nλ = Nφ = **201**, in order to obtain a detailed world map…"

**Correction to the Mapbox blog:** the blog states the paper's grid is *"24x24 in the paper, or 576 points"* and *"smaller by an arbitrary factor of 1.414"*. The shrink factor 1.414 = √2 is right; **the grid size is wrong — the paper says 21×21 = 441** (and 201×201 for the first pass). Cite the paper, not the blog, for the grid.

Also from the paper, useful for your generator: *"If the polygon is given with high enough resolution … the distance between a point and the polygon in spherical coordinates is equivalent to the smallest distance from the point to all of the polygon's corners. … If the vertex distribution in the polygon is not dense enough then the formula corresponding to the distance from a point to a line segment should be used instead."* Polylabel always uses point-to-segment (`getSegDistSq`), which is the correct choice for coarse Voronoi region boundaries.

Verified results (for sanity-checking any implementation): EPIA1 44°18′01″N 81°51′31″E, 2510 ± 10 km from the sea; EPIA2 45°17′60″N 88°08′24″E, 2514 ± 7 km; Point Nemo 48°52.6′S 123°23.6′W, 2690 ± 2 km.

### 1.6 Alternatives and how they differ

| Implementation | What it returns | Notes | URL |
|---|---|---|---|
| **mapbox/polylabel** JS | `[x, y]` with a non-enumerable `.distance` property (the inscribed radius) | `precision` default 1.0; `.distance` is free and is exactly what you want for label sizing | https://cdn.jsdelivr.net/npm/polylabel@1.1.0/polylabel.js |
| **Shapely `shapely.ops.polylabel`** | `Point` | `polylabel(polygon, tolerance=1.0)`. **In Shapely 2.1.2 it is now a thin wrapper**: `line = maximum_inscribed_circle(polygon, tolerance); return get_point(line, 0)` — i.e. it delegates to GEOS, it is no longer a Python port of the quadtree. Docstring still says "Based on Vladimir Agafonkin's https://github.com/mapbox/polylabel". Verified by reading `shapely-2.1.2/shapely/algorithms/polylabel.py` from the PyPI sdist. | https://pypi.org/project/shapely/ |
| **PostGIS `ST_MaximumInscribedCircle`** | **record `(center geometry, nearest geometry, radius double precision)`** | "Finds the largest circle that is contained within a (multi)polygon, or which does not overlap any lines and points." Availability **3.1.0**, requires **GEOS ≥ 3.9.0**. Internal rings are treated as additional boundaries. **`radius` is the inscribed radius — directly usable for label sizing.** | https://postgis.net/docs/ST_MaximumInscribedCircle.html |
| **PostGIS `ST_PointOnSurface`** | `geometry` (a POINT) | "guaranteed to lie in the interior of a surface". OGC SFS 1.1 §3.2.14.2/§3.2.18.2, SQL-MM 3: 8.1.5, 9.5.6. It is *cheap and guaranteed-inside* but **not** a visual center — GEOS computes it by a horizontal scanline through the interior, so on an L-shape it lands wherever the scanline happens to be widest, not at the largest inscribed circle. Use it as a fallback, never as the primary. | https://postgis.net/docs/ST_PointOnSurface.html |
| **PostGIS `ST_ApproximateMedialAxis`** | medial axis geometry | SFCGAL-backed, "based on its straight skeleton"; availability **2.2.0**; **deprecated as of 3.5.0** in favour of `CG_ApproximateMedialAxis`. Falls back to wrapping `CG_StraightSkeleton` (slower) when SFCGAL < 1.2.0. | https://postgis.net/docs/ST_ApproximateMedialAxis.html |
| **Mapnik `text-placement: interior`** | interior point | **A modified polylabel** — see §2.6. | https://cdn.jsdelivr.net/gh/mapnik/mapnik@master/src/geometry/interior.cpp |

**Sizing hook:** both polylabel's `.distance` and PostGIS's `radius` give you the inscribed radius `r`. A one-line font-size heuristic that is dimensionally correct: `fontSize ≈ 2r / k`, with `k` ≈ 1.2–1.6 depending on how much of the disc you want the cap-height to occupy. This alone is a decent size prior *before* you do any principal-axis fitting.

---

## PART 2 — LABEL ANGLE AND SIZE FROM REGION SHAPE

### 2.1 PCA / principal axis — full closed form for a symmetric 2×2

Given the covariance matrix

```
C = [ cxx  cxy ]
    [ cxy  cyy ]
```

**Eigenvalues (closed form):**

```
T = cxx + cyy                                  (trace)
D = sqrt( (cxx - cyy)^2 + 4*cxy^2 )            (discriminant, always >= 0)
λ1 = (T + D) / 2        (major)
λ2 = (T - D) / 2        (minor)
```

Equivalently, from Wikipedia's *Image moment* article (using normalized central moments μ'):

> λᵢ = (μ'₂₀ + μ'₀₂)/2 ± sqrt( 4μ'₁₁² + (μ'₂₀ − μ'₀₂)² ) / 2

**Eigenvectors:** for `λ1`, any non-zero column of `(C − λ2·I)`; numerically stable form:

```
if (cxy != 0):  v1 = normalize([ λ1 - cyy , cxy ])   // or [ cxy , λ1 - cxx ], pick larger magnitude
else:           v1 = (cxx >= cyy) ? [1,0] : [0,1]
v2 = [-v1.y, v1.x]                                    // perpendicular, by symmetry of C
```

**Orientation angle (the one you want):**

```
theta = 0.5 * atan2( 2*cxy , cxx - cyy )
```

Wikipedia gives it as `Θ = ½ arctan( 2μ'₁₁ / (μ'₂₀ − μ'₀₂) )` and explicitly warns *"The above formula holds as long as μ'₂₀ − μ'₀₂ ≠ 0"* — **use `atan2`, not `atan`**, exactly as you wrote it. `atan2` removes the singularity and gives `theta ∈ (−π/2, π/2]`, the correct half-turn range for an unsigned axis. Source: https://en.wikipedia.org/wiki/Image_moment (raw wikitext: https://en.wikipedia.org/w/index.php?title=Image_moment&action=raw)

**Elongation / eccentricity:** `elongation = sqrt(λ1/λ2)`; Wikipedia's eccentricity is `sqrt(1 − λ2/λ1)`.

**Extent along the principal axis (the sizing hook).** `sqrt(λ1)` is a standard deviation, not a half-length. Conversion factors, both exact:
- **Uniform rectangle**: `var = a²/3` where `a` = half-length ⇒ **`half_extent = sqrt(3)·sqrt(λ1) ≈ 1.732·σ1`**
- **Uniform ellipse**: `var = a²/4` ⇒ **`half_extent = 2·σ1`**

I verified the rectangle case numerically: for a 200×50 rectangle, `σ1 = 57.735`, and `σ1·√3 = 100.0000` = the true half-length. Use `1.732·σ1` for polygonal regions; it is a *conservative* estimate for convex-ish blobs and an *over*estimate for spiky ones, so clamp against the min-area-rect width (§2.3).

### 2.2 Polygon second moments — EXACT formulas (these are the ones that matter)

**Source:** Wikipedia, *Second moment of area* § "Any polygon". Raw wikitext (formulas intact): https://en.wikipedia.org/w/index.php?title=Second_moment_of_area&action=raw
Primary references cited there: **D. Hally (1987), "Calculation of the Moments of Polygons", Canadian National Defense Technical Memorandum 87/209** (https://apps.dtic.mil/dtic/tr/fulltext/u2/a183444.pdf); **C. Steger (1996), "On the Calculation of Arbitrary Moments of Polygons"**; **Soerjadi (1968)**.

Vertices numbered **counter-clockwise**, `1 ≤ i ≤ n`, with `(x_{n+1}, y_{n+1}) = (x_1, y_1)`. Wikipedia: *"If polygon vertices are numbered clockwise, returned values will be negative, but absolute values will be correct."*

Let `a_i = x_i·y_{i+1} − x_{i+1}·y_i` (the shoelace cross term).

```
A   = (1/2)  * Σ a_i                                                     (signed area)
Cx  = (1/(6A)) * Σ (x_i + x_{i+1}) * a_i                                 (centroid x)
Cy  = (1/(6A)) * Σ (y_i + y_{i+1}) * a_i                                 (centroid y)

Iy  = (1/12) * Σ a_i * ( x_i^2 + x_i*x_{i+1} + x_{i+1}^2 )               ( = ∫ x^2 dA )
Ix  = (1/12) * Σ a_i * ( y_i^2 + y_i*y_{i+1} + y_{i+1}^2 )               ( = ∫ y^2 dA )
Ixy = (1/24) * Σ a_i * ( x_i*y_{i+1} + 2*x_i*y_i + 2*x_{i+1}*y_{i+1} + x_{i+1}*y_i )   ( = ∫ xy dA )
```

**These are about the ORIGIN.** You must shift to the centroid with the parallel-axis theorem before feeding PCA:

```
Iy_c  = Iy  - A * Cx^2
Ix_c  = Ix  - A * Cy^2
Ixy_c = Ixy - A * Cx * Cy
```

**Then the covariance matrix is the centroidal second moments divided by area:**

```
cxx = Iy_c  / A      // variance in x   (note: Iy, not Ix — Iy = ∫x² dA)
cyy = Ix_c  / A      // variance in y
cxy = Ixy_c / A
theta = 0.5 * atan2(2*cxy, cxx - cyy)
```

The `Iy ↔ x` / `Ix ↔ y` swap is the single most common bug here. `I_y` is the second moment *about the y-axis*, i.e. `∫x² dA`, so it feeds `cxx`.

**Numerical validation** (my run, rectangle 200×50 centred at origin):

```
A   = 10000        exact 4ab       = 10000        ✓
Iy_c= 33333333.33  exact 4a³b/3    = 33333333.33  ✓
Ix_c= 2083333.33   exact 4ab³/3    = 2083333.33   ✓
Ixy_c = 0.000000                                  ✓
var(x) = 3333.3333 exact a²/3      = 3333.3333    ✓
theta at rotations 0/15/30/45/60/90/135 deg  ->  0.0000 / 15.0000 / 30.0000 / 45.0000 / 60.0000 / 90.0000 / -45.0000
elongation = 4.000 at every rotation (rotation-invariant, as required)
```

### 2.3 Area-weighted vs vertex-sampled covariance — this is a correctness issue, not a nicety

Vertex-sampled PCA (mean and covariance of the raw vertex coordinates) is **biased by vertex density**. A Voronoi region boundary has wildly uneven vertex spacing — the boundary against a coastline or a neighbour with tiny cells has 10× the vertex density of a boundary against a big cell. Vertex-sampled PCA will rotate the label toward the densely-sampled side.

Measured demonstration (my run). A symmetric triangle `(0,0),(400,0),(200,120)` whose true principal axis is horizontal, with 99 extra collinear vertices inserted along the `(200,120)→(0,0)` edge:

```
area-weighted theta  =  -0.000 deg     <- correct
vertex-sampled theta =  25.477 deg     <- 25.5 degrees of pure sampling artefact
clean triangle, area-weighted theta = 0.000 deg
```

Even when `theta` survives, the *scale* is wrong. A 200×50 rectangle with 39 extra vertices on one short edge:

```
area-weighted  var(x)/var(y) = 16.000   (= (a/b)^2 = 4^2, exact)
vertex-sampled var(x)/var(y) =  7.465   (elongation underestimated by 2x)
```

**Conclusion: always use the area-weighted polygon second moments above.** If you prefer to work from cells rather than the boundary ring, an equivalent and often more convenient formulation for a Voronoi generator is a **cell-area-weighted point covariance**: treat each cell `c` in the region as a point mass at its site `(x_c, y_c)` with weight `w_c = area(c)`:

```
W = Σ w_c ;  mx = Σ w_c x_c / W ;  my = Σ w_c y_c / W
cxx = Σ w_c (x_c-mx)^2 / W ;  cyy = Σ w_c (y_c-my)^2 / W ;  cxy = Σ w_c (x_c-mx)(y_c-my) / W
```
This is a first-order approximation (it ignores each cell's own second moment, adding `Σ w_c·I_c/W` to the diagonal), but for a region of ≥ ~30 roughly-equal cells the error is a few percent and it is O(cells) with no ring extraction. If your cells are near-uniform in area you can even set `w_c = 1`, which is what "unweighted cell PCA" means — acceptable, but the area weighting is one extra multiply.

### 2.4 Minimum-area bounding rectangle via rotating calipers

**The theorem.** Toussaint 1983, §2, verbatim:

> **Theorem 2.1:** The rectangle of minimum area enclosing a convex polygon has a side collinear with one of the edges of the polygon.

Toussaint attributes it to **[2] H. Freeman and R. Shapira, "Determining the minimum-area encasing rectangle for an arbitrary closed curve", CACM 18(7):409–413, 1975**, DOI 10.1145/360881.360919 (open access). Toussaint continues:

> "The algorithm presented in [2] constructs a rectangle in O(n) time for each edge of P and selects the smallest of these for a total running time of O(n²). This problem can be solved in **O(n) time using two pairs of calipers orthogonal to each other**."

And the O(n) argument, verbatim:

> "As in Shamos' diameter algorithm we now have four, instead of two, angles to consider θi, θj, θk and θl. Let θi = min{θi, θj, θk, θl}. We 'rotate' the four lines of support by an angle θi, L(pi,pi+1) forms the base line of the rectangle associated with edge pipi+1 and the corners of the rectangle can be computed easily in O(1) time from the coordinates of pi, pi+1, pj, pk and pl. We now have a new set of angles and the procedure is repeated until we scan the entire polygon. The area of each rectangle can be computed in constant time in this way resulting in a total running time of O(n)."

**Citation:** G. T. Toussaint, "Solving geometric problems with the rotating calipers", *Proc. MELECON '83*, Athens, Greece, 24–26 May 1983, IEEE, pp. A10.02/1–4.
**PDF (verified, 63 KB):** https://cgm.cs.mcgill.ca/~godfried/publications/calipers.pdf (mirror: https://www-cgrl.cs.mcgill.ca/~godfried/publications/calipers.pdf, also https://web.cs.swarthmore.edu/~adanner/cs97/s08/pdf/calipers.pdf)
**Wikipedia summaries:** https://en.wikipedia.org/wiki/Rotating_calipers and https://en.wikipedia.org/wiki/Minimum_bounding_box_algorithms

**Best implementation reference:** David Eberly, *"Minimum-Area Rectangle Containing a Set of Points"*, Geometric Tools, created 2015-05-17, last modified 2020-09-11 — https://www.geometrictools.com/Documentation/MinimumAreaRectangle.pdf (verified, 316 KB, 13 pp.). It gives both the O(n²) and O(n) versions plus the robustness sections you actually need ("4.1 Avoiding Normalization", "4.2 Indirect Comparisons of Angles"). Eberly, §3, verbatim:

> "The rotating calipers algorithm starts with a bounding rectangle having an edge coincident with a polygon edge and a supporting set of polygon vertices for the other polygon edges. The rectangle axes are rotated counterclockwise by the smallest angle that leads to the rectangle being coincident with another polygon edge. The new supporting set of vertices is built from the previous set and from the new polygon edge vertices."
> Loop invariant: "you have axis directions {U0, U1} and supporting indices I = {b, r, t, ℓ}, ordered by the edges they support: bottom (b), right (r), top (t), and left (ℓ)."
> Constraint: "It is essential to require that the polygon have no triple of collinear vertices."
> Perp convention: "Perp(x, y) = (y, −x)."

**Pseudocode.** In practice, for a Voronoi region whose convex hull has `h` ≈ 20–80 vertices, the O(h²) edge-scan is what you should ship — it is 15 lines, has no degenerate-angle cases, and at h = 80 costs 6400 dot products (microseconds). This is Eberly's Listing 1, transliterated to TS and **validated by my run**:

```ts
type Rect = { cx: number; cy: number; angle: number; w: number; h: number; area: number };

// pts: region boundary vertices (any order). Returns the min-area rect,
// with `w` = LONG side and `angle` = direction of the long side in (-pi/2, pi/2].
function minAreaRect(pts: [number, number][]): Rect {
  const H = convexHull(pts);              // monotone chain, O(n log n)
  const n = H.length;
  let best: Rect | null = null;

  for (let i = 0; i < n; i++) {
    const o = H[i], e = H[(i + 1) % n];
    const L = Math.hypot(e[0] - o[0], e[1] - o[1]);
    const ux = (e[0] - o[0]) / L, uy = (e[1] - o[1]) / L;   // U0 = edge direction
    const vx = -uy,             vy =  ux;                    // U1 = -Perp(U0)

    let m0 = Infinity, M0 = -Infinity, m1 = Infinity, M1 = -Infinity;
    for (const q of H) {                                     // project hull onto both axes
      const dx = q[0] - o[0], dy = q[1] - o[1];
      const du = dx * ux + dy * uy, dv = dx * vx + dy * vy;
      if (du < m0) m0 = du; if (du > M0) M0 = du;
      if (dv < m1) m1 = dv; if (dv > M1) M1 = dv;
    }
    const w = M0 - m0, h = M1 - m1, area = w * h;
    if (!best || area < best.area) best = {
      area, w, h, angle: Math.atan2(uy, ux),
      cx: o[0] + ((m0 + M0) / 2) * ux + ((m1 + M1) / 2) * vx,
      cy: o[1] + ((m0 + M0) / 2) * uy + ((m1 + M1) / 2) * vy,
    };
  }
  // normalise so w is the long side and angle is the label direction
  if (best!.w < best!.h) { [best!.w, best!.h] = [best!.h, best!.w]; best!.angle += Math.PI / 2; }
  best!.angle = Math.atan2(Math.sin(best!.angle), Math.cos(best!.angle));
  if (best!.angle >  Math.PI / 2) best!.angle -= Math.PI;
  if (best!.angle < -Math.PI / 2) best!.angle += Math.PI;
  return best!;
}
```

Verified: for a 200×50 rectangle rotated 30°, it returns `{area: 10000, w: 200.000, h: 50.000, angle: 30.0000°}` — exact.

**PCA vs min-area-rect disagree, and you want both.** My L-shape test (`(0,0),(300,0),(300,60),(60,60),(60,240),(0,240)`, area 28800):

```
PCA:           theta = -30.964 deg, sigma1 = 101.00, elongation = 2.000
minAreaRect:   angle =   0.000 deg, w = 300.0, h = 240.0, area = 72000
```

The min-area rect is 2.5× the polygon's own area — a useless size bound for an L. PCA gives a plausible diagonal angle but the label would cross the notch. **Neither is reliable alone on non-convex regions.** Practical rule:
- `rectArea / polygonArea < ~1.6` ⇒ region is convex-ish; trust the min-area rect for both angle and width.
- otherwise ⇒ fall back to PCA for angle and to a **ray-cast width probe from the pole of inaccessibility** for the usable length (this is exactly what Azgaar does — Part 3).

### 2.5 Medial axis / straight skeleton — why it's overkill, and what to use instead

**Definitions and the key distinction**, from CGAL's *Straight Skeleton 2* package (https://doc.cgal.org/latest/Straight_skeleton_2/index.html): the skeleton is traced by wavefronts propagating inward from each edge; its bisectors are *"not equidistant to its defining edges but to the supporting lines of such edges"*, which makes them deviate from the true polygon center at reflex vertices. **For convex polygons the straight skeleton, the medial axis and the Voronoi diagram coincide.** CGAL uses `Exact_predicates_inexact_constructions_kernel` by default and notes that requiring simple offset polygons forces an exact kernel, which is *"very slow"* — the recommended workaround is to build with the inexact kernel and convert. CGAL's docs **do not state an explicit complexity bound** for the implementation (a commonly-quoted O(n² log n) figure is **not** in the CGAL docs — do not cite it to CGAL).

**Why it's overkill for your case, in Mapbox's own words** (blog, §1.1 above): *"The published solutions to the problem require either Constrained Delaunay Triangulation or computing a straight skeleton as preprocessing steps — both of which are slow and error-prone."*

Worth knowing: **ArcGIS Maplex actually does use the medial axis.** From https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/labels-for-polygon-features.html: *"By default, polygon labels are placed horizontally within polygons. You can also place labels **along the medial axis** or following the general curvature of the polygon."* So it is the professional-grade answer — it's just a lot of machinery.

**Practical substitutes, in increasing order of cost:**
1. **polylabel + PCA angle.** Position from the inscribed-circle center, angle from area-weighted second moments. ~2 ms per region. This is the 90% solution.
2. **Radial ray-cast fan from the pole** (Azgaar's approach, Part 3). Cast N rays from the pole, keep the two whose lengths and mutual angle score best, and use the polyline through `[endA, pole, endB]` as a text path. This is a cheap discrete approximation of "the longest chord through the visual center" and it degrades gracefully on concave shapes where PCA lies. ~40 rays × 60 steps = 2400 point-in-region tests per region.
3. **Erosion / distance-transform ridge.** Rasterize the region, compute a distance transform, threshold near the max — the ridge of the DT *is* the medial axis, approximately, and you get it in O(pixels) with two passes. Maplex names this concept directly: its polygon anchor point types include **`ErodedCenter`** (CIM enum `MaplexAnchorPointType`: `GeometricCenter=0, ErodedCenter=1, Perimeter=2, UnclippedGeometricCenter=3` — https://cdn.jsdelivr.net/gh/Esri/cim-spec@main/docs/v3/CIMLabelPlacement.md).
4. **Full straight skeleton** (CGAL, SFCGAL / `ST_ApproximateMedialAxis`). Only if you want river-style labels that follow a snaking region.

### 2.6 How real map renderers pick area-label size and angle

#### Mapnik

**Verified against the machine-readable spec:** `mapnik-reference` (the same file `carto` compiles against), v3.0.22 — https://cdn.jsdelivr.net/npm/mapnik-reference@8.10.0/3.0.22/reference.json

| property | type / values | default | doc |
|---|---|---|---|
| `placement` | `point, line, vertex, interior, grid, alternating-grid` | `point` | "…and **interior** attempts to place inside of a polygon." |
| `minimum-path-length` | float | **0.0** | 3.0.x: "Place labels only on polygons and lines with a **bounding width** longer than this value (in pixels)." 2.0.0–2.3.0: "Place labels only on paths longer than this value." Key name is `minimum-path-length` in every version 2.0.0 → 3.0.22 (I checked all of them). The CartoCSS surface spelling `text-min-path-length` is the commonly-cited form but **I could not verify that alias from a primary source** — cite `minimum-path-length`. |
| `size` | float | **10.0** | "Text size in pixels." |
| `max-char-angle-delta` | float | **22.5** | "The maximum angle change, in degrees, allowed between adjacent characters… internally converted to radians so the default is 22.5*π/180." |
| `horizontal-alignment` | `left, middle, right, auto, adjust` | `auto` | **"If `placement` is set to `line`, then `adjust` can be set to auto-fit the text to the length of the path by dynamically calculating `character-spacing`."** ← this is Mapnik's "fit text to extent" mechanism |
| `character-spacing` | float | 0.0 | "ignored when `horizontal-alignment` is set to `adjust`" |
| `simplify` / `smooth` | float | 0.0 / 0.0 | pre-smoothing of the placement geometry; `smooth` 0 = none, 1 = fully smoothed |
| `repeat-distance`, `margin`, `avoid-edges`, `allow-overlap` | — | 0.0, 0.0, false, false | conflict control |
| `wrap-width`, `text-ratio` | unsigned | 0, 0 | `wrap-width` in pixels; 0 = no wrapping |

**Mapnik's `interior` placement is a modified polylabel.** Source header (https://cdn.jsdelivr.net/gh/mapnik/mapnik@master/src/geometry/interior.cpp):

```cpp
// Interior algorithm is realized as a modification of Polylabel algorithm
// from https://github.com/mapbox/polylabel.
// The modification aims to improve visual output by prefering
// placements closer to centroid.
```

The modification is a **fitness function that discounts distance-from-centroid**:

```cpp
T operator()(point<T> const& cell_center, T distance_polygon) const
{
    if (distance_polygon <= 0) return distance_polygon;
    point<T> d = cell_center - centroid;
    double distance_centroid = std::sqrt(d.x * d.x + d.y * d.y);
    return distance_polygon * (1 - distance_centroid / max_size);
}
```
with `max_size = max(bbox.width, bbox.height)`, and the cell potential becomes `max_fitness = ff(c, d + h*sqrt(2))` rather than raw `d + h√2`. Termination is unchanged: `if (current_cell.max_fitness - best_cell.fitness <= precision) continue;`, `precision` default 1. **This is a directly stealable idea:** it kills the "label jumps to a far peninsula that happens to be marginally wider" failure mode that plain polylabel has on lumpy Voronoi regions.

#### QGIS

**URL:** https://docs.qgis.org/latest/en/docs/user_manual/style_library/label_settings.html

Polygon placement modes, exact names:
- **Offset from Centroid** — over the centroid or at a fixed X,Y offset; options to force the centroid inside the polygon, restrict to quadrants, and allow outside placement.
- **Around Centroid** — "places the label within a preset distance around the centroid, with a preference for the placement directly over the centroid."
- **Horizontal** — "places at the best position a horizontal label inside the polygon", preferring placements far from edges.
- **Free (Angled)** — **"places at the best position a rotated label inside the polygon. The rotation respects the polygon's orientation"** ← this is QGIS's principal-axis mode, the direct analogue of what you're building.
- **Using Perimeter** / **Using Perimeter (Curved)** — parallel to the generalized boundary; the curved variant has a max angle between characters.
- **Outside Polygons** — "always places labels outside the polygons, at a set Distance".

Also: centroid may be computed from "visible polygon versus whole polygon"; there is a "force the centroid point to lay inside their polygon" toggle; and "Allow placing labels outside of polygons" is settable per-feature via data-defined properties.

#### ArcGIS Pro — Maplex Label Engine

Docs live under `https://pro.arcgis.com/en/pro-app/latest/help/mapping/text/…` which **302-redirects to `https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/…`**. The path `…/help/labeling/` in your brief 404s.

**Polygon placement positions** — https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/specify-a-polygon-label-position.html, exact UI names and quoted descriptions:

- **Horizontal in polygon** — "Places the label horizontally inside the polygon."
- **Straight in polygon** — "Places the label linearly inside the polygon."
- **Curved in polygon** — "Places the label curved inside the polygon."
- **Horizontal around polygon** — "Places the label horizontally at the best position outside the polygon."
- **Curved around polygon** — "Places the label curved at the best position outside the polygon."
- **Try horizontal position first** (available with Straight/Curved in polygon) — "tries to place the label horizontally inside the polygon before it attempts to place the label using the selected placement style."
- **May place label outside polygon boundary** — external zones ranked **1 to 8**, "where 1 is the first zone to be tried and 8 is the last zone. You can give a zone the value 0 to prohibit labels."
- **Place label at fixed position within polygon** — internal zones ranked **1 to 9**, 0 to prohibit.
- **Place label using clipped feature geometry**, **Avoid holes in polygons**, **Avoid overlapping labeled polygons as if holes**.

The corresponding CIM enum (canonical, machine-readable) — `MaplexPolygonPlacementMethod` in https://cdn.jsdelivr.net/gh/Esri/cim-spec@main/docs/v3/CIMLabelPlacement.md:

```
HorizontalInPolygon=0, StraightInPolygon=1, CurvedInPolygon=2,
HorizontalAroundPolygon=3, RepeatAlongBoundary=4 ("Boundary placement"), CurvedAroundPolygon=5
```
and `MaplexPolygonFeatureType`: `General=0, LandParcel=1, River=2, Boundary=3`. The **River** style is the elongated-region case: *"generalizes the trend line for the turns of the polygon river and places the label following that smoother line"* (https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/label-using-the-river-placement-style-for-polygon-features.html) — that is precisely the "curved label along the shape's spine" behaviour Azgaar approximates.

**FONT SIZE REDUCTION — the numeric behaviour you asked for** — https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/reduce-the-size-of-the-label-text.html:

> "**Font size reduction / Lower limit** is the smallest allowable reduced font size. This parameter instructs the Maplex Label Engine to reduce both the font height and width without changing the aspect ratio. **Font size reduction / Step interval** is the amount by which the font size may be progressively reduced to place a label."
> **Worked example (Esri's own):** "for a label with a base font size of **10 points**, you can set a lower limit of **6 points** and a step interval of **0.5**. The Maplex Label Engine places variants of the label using **10, 9.5, 9.0, or 8.5 points**, starting at the base font size and reducing it by the step interval until the lower limit is reached. **Once the label is placed, the smaller size levels are not tried.**"
> **Font width compression:** "The lower limit can range between **0.1 and 100 percent** of the original font width, and the step interval can range between **0.1 and 50 percent** of the base font width." Example: "compress the width of the font in a label to **85 percent** … step interval of **5 percent**. The label engine places the label at 100 percent… compresses to 95 percent, 90 percent, and 85 percent, stopping when the label fits."
> **Combined:** base 10 pt, lower limit 8 pt, step 0.5 ⇒ 5 size levels; compression lower limit 85%, step 5% ⇒ 4 levels ⇒ **20 combinations, tried in Strategy order**, e.g. `10pt/100%, 10pt/95%, 10pt/90%, 10pt/85%, 9.5pt/100%, …` when Font compression outranks Font reduction.
> Caveat: "The font size and width are **not** compressed or reduced if the label expression contains text formatting tags that specify the label's font size or line leading."

Note the ranges given (0.1–100%, 0.1–50%) are **allowed ranges, not defaults**. Esri's help does **not** publish the shipped default values for `fontHeightReductionLimit` / `fontHeightReductionStep` — **I could not verify those defaults from any source.** The CIM spec confirms the fields exist and are `double`:

```
fontHeightReductionLimit | double | "Font height reduction limit. The font may be reduced in height until this limit is reached."
fontHeightReductionStep  | double | "Font height reduction step. This is the step interval for font height reduction."
fontWidthReductionLimit  | double | fontWidthReductionStep | double
canReduceFontSize | canStackLabel | canAbbreviateLabel | canTruncateLabel | canOverrunFeature | neverRemoveLabel | boolean
maximumLabelOverrun | maximumWordSpacing | maximumCharacterSpacing | double
```

**STACKING limits** — https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/stack-labels.html:
- **Maximum number of lines**: "from **1 to 50**".
- **Minimum characters per line**: "from **1 to 8**, that must be in the shortest part of a stacked label."
- **Maximum characters per line**: "from **2 to 80**".
- Default separators: "the space character and comma are already entered in the **Separator** list."
- **"The label stacks to only two rows when curved placement styles are used."** ← directly relevant: Azgaar's two-line state labels hit the same constraint.
- Alignment options: `Choose best`, `Constrain left or right`, `Constrain left`, `Constrain right`, `Constrain center`.

**Fitting strategy order** — https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/why-use-additional-strategies-for-placing-labels-.html and https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/strategy-order.html. The five orderable strategies are **Stack labels, Allow labels to overrun a feature, Reduce the size of the label text, Abbreviate and truncate labels, Key numbering**. "The Maplex Label Engine applies label-fitting strategies in the order that they are listed on the Strategy tab… but if an increased number of labels can be placed by changing the preferred strategy order, the label engine applies a new order." And: "Key numbering is not listed as a strategy to be ordered. If enabled, it will always be tried **after** all other strategies."

**SPREADING (letter/word spacing to fill a region)** — https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/spread-a-label-through-a-polygon-feature.html. This is the mechanism that makes `T H E   G R E A T   S E A` labels:
- **Spread words**: `Use default word spacing` / `Spread words to fill feature` / `Spread words up to a fixed limit`, `Maximum` "expressed as a **percentage of the font width**". "The Maplex Label Engine stretches the label until it either encounters the boundaries of the feature, conflicts with other labels, or reaches the maximum word spacing distance." **Only available for the Regular and River placement styles.**
- **Spread letters**: `Use default letter spacing` / `Spread letters to fill feature` / `Spread letters up to a fixed limit`, same percentage-of-font-width semantics. "**Not** available with the Boundary placement style or the Offset horizontal position."
- The text symbol's own Letter spacing / Word spacing "become the **minimum** values when you use the Spread labels labeling option."

---

## PART 3 — AZGAAR'S FANTASY MAP GENERATOR

### 3.0 Important: the file layout in your brief is stale

`modules/ui/labels.js`, `modules/drawing.js` and a root `main.js` **do not exist** in current master. The repo was restructured (checked at **v1.138.0**, commit `51d8e3e`). Current layout:

- **`src/renderers/draw-state-labels.ts`** ← all state-label geometry (375 lines). This is what you want.
- `src/utils/pathUtils.ts` — `getPolesOfInaccessibility()`
- `src/generators/states-generator.ts` / `provinces-generator.ts` — call sites
- `src/renderers/draw-burg-labels.ts`, `src/controllers/labels-editor.ts`
- `public/main.js` — `invokeActiveZooming()` (label rescaling)
- `public/modules/ui/layers.js`, `public/modules/ui/style-presets.js`, `public/styles/*.json`

`api.github.com` and `codeload.github.com` are blocked by the egress policy in this session; **`https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/<path>` works** and mirrors GitHub exactly. File index: `https://data.jsdelivr.com/v1/packages/gh/Azgaar/Fantasy-Map-Generator@master?structure=flat`.

**There is no `getLetterSpacing` function anywhere in the repo** (I grepped the full tree). Letter-spacing is a *static style attribute*, default `0`, edited by a UI slider — `src/controllers/labels-editor.ts:531`: `elSelected.select("textPath").attr("letter-spacing", `${this.value}px`)`, and `public/modules/ui/style.js:508`. Azgaar does **not** use letter-spacing to fit text. He scales `font-size` instead.

### 3.1 Placement: it IS polylabel, at precision 20

`src/utils/pathUtils.ts`, lines ~247–260 (jsDelivr: `https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/utils/pathUtils.ts`):

```ts
export const getPolesOfInaccessibility = (
  graph: PackedGraph,
  getType: (cellId: number) => string | number
): Record<string, [number, number]> => {
  const isolines = getIsolines(graph, getType, { polygons: true });

  const poles = Object.entries(isolines).map(([id, isoline]) => {
    const multiPolygon = (isoline.polygons as unknown as number[][][]).sort((a, b) => b.length - a.length);
    const [x, y] = polylabel(multiPolygon, 20);
    return [id, [rn(x), rn(y)]];
  });

  return Object.fromEntries(poles);
};
```

Notes worth stealing:
- **`precision = 20`**, not 1.0. On a ~1000-px-wide map that is deliberately coarse — the pole only needs to be right to ~20 px because it is a *seed for the ray-cast fan*, not the final anchor.
- The rings are **sorted descending by vertex count** before the call. polylabel treats `polygon[0]` as the outer ring, so this makes the largest ring the outer one — a pragmatic fix for a multi-part state.
- Called once at generation time: `src/generators/states-generator.ts:245–251` → `s.pole = poles[s.i] || [0, 0]`; same for provinces (`provinces-generator.ts:331`).
- Elsewhere: `src/renderers/draw-measurers.ts:132` uses `polylabel([measurer.points], 1.0)` — the *default* precision, for a small planimeter polygon.

Bundled library: `public/libs/polylabel.min.js` (3085 bytes) and an npm `polylabel` import in the TS sources.

### 3.2 Angle and path: a scored ray-cast fan from the pole

This is the interesting part, and it is *not* PCA. Full constants block, `src/renderers/draw-state-labels.ts:35–46`:

```ts
  // increase step to 15 or 30 to make it faster and more horyzontal
  // decrease step to 5 to improve accuracy
  const ANGLE_STEP = 9;
  const angles = precalculateAngles(ANGLE_STEP);

  const LENGTH_START = 5;
  const LENGTH_STEP = 5;
  const LENGTH_MAX = 300;
```

`ANGLE_STEP = 9` ⇒ **40 rays** at 9° increments (`precalculateAngles` loops `angle = 0; angle < 360; angle += step`, storing `dx = cos(angle·π/180)`, `dy = sin(...)`).

Per state (`getLabelPaths`, lines 51–88):

```ts
      const offset = getOffsetWidth(state.cells!);
      const maxLakeSize = state.cells! / 20;
      const [x0, y0] = state.pole!;

      const rays: Ray[] = angles.map(({ angle, dx, dy }) => {
        const { length, x, y } = raycast({ stateId: state.i, x0, y0, dx, dy, maxLakeSize, offset });
        return { angle, length, x, y };
      });
      const [ray1, ray2] = findBestRayPair(rays);

      const pathPoints: PathPoints = [[ray1.x, ray1.y], state.pole!, [ray2.x, ray2.y]];
      if (ray1.x > ray2.x) pathPoints.reverse();
```

**Ray thickness (a corridor, not a line)** — `getOffsetWidth`, lines 170–174:

```ts
  function getOffsetWidth(cellsNumber: number): number {
    if (cellsNumber < 40) return 0;
    if (cellsNumber < 200) return 5;
    return 10;
  }
```

**The raycast itself** (lines 189–253) marches in 5-unit steps from 5 to 300 and requires the ray point **and two perpendicular offset points** to all be inside the state:

```ts
    for (let length = LENGTH_START; length < LENGTH_MAX; length += LENGTH_STEP) {
      const [x, y] = [x0 + length * dx, y0 + length * dy];
      // offset points are perpendicular to the ray
      const offset1: [number, number] = [x + -dy * offset, y + dx * offset];
      const offset2: [number, number] = [x + dy * offset, y + -dx * offset];
      ...
      const inState = isInsideState(x, y) && isInsideState(...offset1) && isInsideState(...offset2);
      if (!inState) break;
      ray = { length, x, y };
    }
```

`isInsideState` does a nearest-cell lookup (`findClosestCell`) and checks `stateIds[cellId] === stateId`, with a lake exemption: a lake cell counts as inside if it is an **inner lake** (`feature.shoreline.every(cellId => stateIds[cellId] === stateId)`) **or a small lake** (`feature.cells <= maxLakeSize`, i.e. ≤ 5% of the state's cell count). Out-of-canvas is always outside.

**Choosing the two rays** — this is the "angle" decision, lines 255–312. It is an O(40²/2) = 780-pair brute force maximizing `(len1·angleScore1 + len2·angleScore2) · curvatureScore`:

```ts
  function findBestRayPair(rays: Ray[]): [Ray, Ray] {
    let bestPair: [Ray, Ray] | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < rays.length; i++) {
      const score1 = rays[i].length * scoreRayAngle(rays[i].angle);
      for (let j = i + 1; j < rays.length; j++) {
        const score2 = rays[j].length * scoreRayAngle(rays[j].angle);
        const pairScore = (score1 + score2) * scoreCurvature(rays[i].angle, rays[j].angle);
        if (pairScore > bestScore) { bestScore = pairScore; bestPair = [rays[i], rays[j]]; }
      }
    }
    return bestPair!;
  }

  function scoreRayAngle(angle: number): number {
    const normalizedAngle = Math.abs(angle % 180);            // [0, 180]
    const horizontality = Math.abs(normalizedAngle - 90) / 90; // [0, 1]
    if (horizontality === 1)    return 1;   // Best: horizontal
    if (horizontality >= 0.75)  return 0.9; // Very good: slightly slanted
    if (horizontality >= 0.5)   return 0.6; // Good: moderate slant
    if (horizontality >= 0.25)  return 0.5; // Acceptable: more slanted
    if (horizontality >= 0.15)  return 0.2; // Poor: almost vertical
    return 0.1;                             // Very poor: almost vertical
  }

  function scoreCurvature(angle1: number, angle2: number): number {
    const delta = getAngleDelta(angle1, angle2);
    const similarity = evaluateArc(angle1, angle2);
    if (delta === 180) return 1;              // straight line: best
    if (delta < 90)    return 0;              // acute: not allowed
    if (delta < 120)   return 0.6 * similarity;
    if (delta < 140)   return 0.7 * similarity;
    if (delta < 160)   return 0.8 * similarity;
    return similarity;
  }

  // compute arc similarity towards x-axis
  function evaluateArc(angle1: number, angle2: number): number {
    const proximity1 = Math.abs((angle1 % 180) - 90);
    const proximity2 = Math.abs((angle2 % 180) - 90);
    return 1 - Math.abs(proximity1 - proximity2) / 90;
  }
```

Design reading: this is a **hand-tuned prior that map labels should be near-horizontal** (`scoreRayAngle` penalizes verticality 10:1), **near-straight** (`delta === 180` is the only unpenalized curvature; `< 90°` is hard-rejected), and **symmetric about the horizontal** (`evaluateArc`). It is exactly the "Try horizontal position first" preference that Maplex exposes as a checkbox, baked in as a continuous score.

**The text path** (lines 99–117) — a d3 natural cubic spline through exactly three points:

```ts
    const lineGen = line<[number, number]>().curve(curveNatural);
    ...
      const textPath = pathGroup
        .append("path")
        .attr("d", round(lineGen(pathPoints) || ""))
        .attr("id", `textPath_stateLabel${stateId}`);
```
written into `defs > g#deftemp > g#textPaths`, and consumed by `<text><textPath startOffset="50%" href="#textPath_stateLabelN">`. Three points + `curveNatural` gives a gentle arc, never a wiggle.

### 3.3 Size: measure one letter, then scale by percentage

**Letter-width calibration** (lines 90–97) — the trick that makes everything font-independent:

```ts
  function checkExampleLetterLength(): number {
    const textGroup = select<SVGGElement, unknown>("g#labels > g#states");
    const testLabel = textGroup.append("text").attr("x", 0).attr("y", 0).text("Example");
    const letterLength = (testLabel.node() as SVGTextElement).getComputedTextLength() / 7; // approximate length of 1 letter
    testLabel.remove();
    return letterLength;
  }
```

Renders the literal string `"Example"` (7 chars) in the live style, divides measured width by 7. Note the whole renderer temporarily un-hides `#labels` (lines 28–30, restored at line 49) so `getComputedTextLength()` returns non-zero.

**Path length is then expressed IN LETTERS** (line 119):

```ts
      const pathLength = (textPath.node() as SVGPathElement).getTotalLength() / letterLength; // path length in letters
```

**Font-size selection** (lines 314–335) — all output is a **percentage of the group's `font-size`**:

```ts
  function getLinesAndRatio(mode: string, name: string, fullName: string, pathLength: number): [string[], number] {
    if (mode === "short") return getShortOneLine();
    if (pathLength > fullName.length * 2) return getFullOneLine();
    return getFullTwoLines();

    function getShortOneLine(): [string[], number] {
      const ratio = pathLength / name.length;
      return [[name], minmax(rn(ratio * 60), 50, 150)];
    }
    function getFullOneLine(): [string[], number] {
      const ratio = pathLength / fullName.length;
      return [[fullName], minmax(rn(ratio * 70), 70, 170)];
    }
    function getFullTwoLines(): [string[], number] {
      const lines = splitInTwo(fullName);
      const longestLineLength = max(lines.map(line => line.length)) || 0;
      const ratio = pathLength / longestLineLength;
      return [lines, minmax(rn(ratio * 60), 70, 150)];
    }
  }
```

The full constant table:

| branch | condition | text | percent formula | clamp |
|---|---|---|---|---|
| short | `mode === "short"` | `state.name` | `round(pathLength/name.length * 60)` | **50–150 %** |
| full, one line | `pathLength > fullName.length * 2` | `state.fullName` | `round(pathLength/fullName.length * 70)` | **70–170 %** |
| full, two lines | otherwise | `splitInTwo(fullName)` | `round(pathLength/longestLine.length * 60)` | **70–150 %** |
| fallback one-liner (after the fit check fails) | — | `pathLength > fullName.length*1.8 ? fullName : name` | `round(pathLength/text.length * 50)` | **50–130 %** |

(`minmax(v,min,max) = Math.min(Math.max(v,min),max)` — `src/utils/numberUtils.ts:19`. `splitInTwo` splits on spaces at the nearest word boundary to the half-length — `src/utils/stringUtils.ts:29`.)

**Path prolongation when the path is too short** (lines 122–134) — instead of shrinking the font below the clamp, he *stretches the path* about its midpoint by `mod = longestLineLength / pathLength`:

```ts
      const longestLineLength = max(lines.map(line => line.length)) || 0;
      if (pathLength && pathLength < longestLineLength) {
        const [x1, y1] = pathPoints.at(0)!;
        const [x2, y2] = pathPoints.at(-1)!;
        const [dx, dy] = [(x2 - x1) / 2, (y2 - y1) / 2];
        const mod = longestLineLength / pathLength;
        pathPoints[0] = [x1 + dx - dx * mod, y1 + dy - dy * mod];
        pathPoints[pathPoints.length - 1] = [x2 - dx + dx * mod, y2 - dy + dy * mod];
        textPath.attr("d", round(lineGen(pathPoints) || ""));
      }
```

**Multi-line layout** (lines 136–147) — `startOffset="50%"`, `font-size` as a percentage, and tspans with an em-based `dy`, first line offset by `top = (lines.length - 1) / -2`:

```ts
      const textElement = textGroup.append("text")
        .attr("text-rendering", "optimizeSpeed")
        .attr("id", `stateLabel${stateId}`)
        .append("textPath")
        .attr("startOffset", "50%")
        .attr("font-size", `${ratio}%`)
        .node() as SVGTextPathElement;

      const top = (lines.length - 1) / -2; // y offset
      const spans = lines.map((lineText, index) => `<tspan x="0" dy="${index ? 1 : top}em">${lineText}</tspan>`);
      textElement.insertAdjacentHTML("afterbegin", spans.join(""));
```

**The containment check and the downgrade** (lines 149–166, 338–370). He takes the rendered bbox, rotates 6 sample points (4 corners + top/bottom mid) by the path's chord angle, and requires **more than 4 of 6 inside the state**:

```ts
      const [[x1, y1], [x2, y2]] = [pathPoints.at(0)!, pathPoints.at(-1)!];
      const angleRad = Math.atan2(y2 - y1, x2 - x1);
      const isInsideState = checkIfInsideState(textElement, angleRad, width / 2, height / 2, stateIds, stateId);
      if (isInsideState) continue;

      // replace name to one-liner
      const text = pathLength > state.fullName!.length * 1.8 ? state.fullName! : state.name!;
      const correctedRatio = minmax(rn((pathLength / text.length) * 50), 50, 130);
      textElement.setAttribute("font-size", `${correctedRatio}%`);
```

```ts
    const points: [number, number][] = [
      [-halfwidth, -halfheight], [+halfwidth, -halfheight],
      [+halfwidth,  halfheight], [-halfwidth,  halfheight],
      [0, halfheight], [0, -halfheight]
    ];
    const sin = Math.sin(angleRad), cos = Math.cos(angleRad);
    const rotatedPoints = points.map(([x, y]): [number, number] => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
    let pointsInside = 0;
    for (const [x, y] of rotatedPoints) {
      const isInside = stateIds[findClosestCell(x, y, undefined, pack) as number] === stateId;
      if (isInside) pointsInside++;
      if (pointsInside > 4) return true;
    }
    return false;
```

This is Maplex's "stack → doesn't fit → abbreviate" ladder in miniature: two-line full name first, single-line short name as the fallback.

### 3.4 Base font sizes and zoom behaviour (real numbers)

From the committed e2e snapshot `tests/e2e/layers.spec.ts-snapshots/labels.html` (verified rendered attributes):

```html
<g id="states"       opacity="1" fill="#3e3e4b" stroke="#3a3a3a" stroke-width="0"
   style="text-shadow: white 0px 0px 4px" letter-spacing="0"
   data-size="22" font-size="22" font-family="Almendra SC"></g>
<g id="addedLabels"  ... data-size="18" font-size="18" font-family="Almendra SC"></g>
```

Burg label groups (`data-size` in px, plus a `data-dy` baseline nudge in em):
`hamlet 2 (dy −0.4)`, `village 3 (−0.4)`, `trading_post 2 (−0.5)`, `caravanserai 2 (−0.5)`, `monastery 2 (−0.5)`, `fort 2 (−0.5)`, `town 4 (−0.4)`, `city 5 (−0.4)`, `capital 6 (−0.5)`.

Per-style-preset state label defaults (`public/styles/*.json`, key `"#labels > #states"`):

| preset | data-size | font-family | letter-spacing | stroke-width |
|---|---|---|---|---|
| `light.json` | **14** | IM Fell English | 0 | 0.3 |
| `atlas.json` | **21** | Amarante | 0 | 0 |
| `cyberpunk.json` | **18** | Orbitron | 0 | 0 |

So the effective state label size is `data-size × ratio%`, e.g. `22 px × 130 % = 28.6 px`. Editable attributes for the group are listed in `public/modules/ui/style-presets.js:297` and include `letter-spacing`, `data-size`, `font-size`.

**Zoom rescaling** — `public/main.js:545–566`, `invokeActiveZooming()`:

```js
  // rescale labels on zoom
  if (labels.style("display") !== "none") {
    labels.selectAll("g").each(function () {
      if (this.id === "burgLabels") return;
      const desired = +this.dataset.size;
      const relative = Math.max(rn((desired + desired / scale) / 2, 2), 1);
      if (rescaleLabels.checked) this.setAttribute("font-size", relative);

      const hidden = hideLabels.checked && (relative * scale < 6 || relative * scale > 60);
      if (hidden) this.classList.add("hidden");
      else this.classList.remove("hidden");
    });
  }
```

`relative = max(round((desired + desired/scale)/2, 2), 1)` — a half-way blend between constant screen size and constant map size, floored at 1 px. Labels are auto-hidden outside **6–60 px on screen**. (Nearby, for comparison, the states halo uses `haloSize = rn(desired / scale ** 0.8, 2)`, `public/main.js:583.`)

---

## SYNTHESIS — what I'd actually implement

1. **Position.** polylabel on the region's outer ring, **precision = 1.0** if the label is the final anchor, or 10–20 if it only seeds a ray fan. Keep `.distance` (the inscribed radius `r`) — it is free. Consider Mapnik's centroid-biased fitness (`d·(1 − |c−centroid|/max(bboxW,bboxH))`) to stop the pole running out onto peninsulas; it is a 5-line change to the `Cell` constructor.
2. **Angle.** Area-weighted polygon second moments (§2.2) → `theta = 0.5·atan2(2cxy, cxx−cyy)`. **Never vertex-sampled** — my triangle test shows a 25.5° error from vertex density alone. Bias toward horizontal exactly the way Azgaar does (multiply an elongation-based confidence by a `cos²`-ish horizontality weight) so near-isotropic regions render flat instead of at a random angle.
3. **Length budget.** Take the minimum of three estimates: `2·√3·σ1` (PCA extent), the min-area rect's long side `w` (§2.4), and — for concave regions — the ray-cast chord length through the pole. Guard with `rectArea/polyArea`: above ~1.6, distrust both PCA and the rect and use the ray cast.
4. **Size.** Calibrate one letter width with `getComputedTextLength()/n` once per style (Azgaar's trick — font-metric independent, one DOM op). Then `fontScale = clamp(availableLength / (letterWidth · text.length), min, max)`. Azgaar's clamps (50–170 %) and Maplex's ladder (reduce in 0.5 pt steps to a floor, then compress width in 5 % steps to 85 %, then stack, then abbreviate) are the two proven shapes for this.
5. **Verify.** Sample 6 rotated points of the final text bbox and require >4 inside the region (Azgaar's `checkIfInsideState`) before committing; downgrade to the short name on failure.

agentId: aecb92d6922bca619 (use SendMessage with to: 'aecb92d6922bca619', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 205210
tool_uses: 93
duration_ms: 1119676</usage>

---

<!-- fuente: curved-text-on-path.md -->

I have everything verified. Writing up the report.

## CURVED TEXT ALONG A PATH — implementable math, real defaults, sources

Everything below was read from primary sources (spec text, or source files fetched with `curl`). Unverified items are flagged explicitly at the end.

---

# 1. Per-character layout along a polyline

## 1.1 The normative algorithm (SVG 2), verbatim

From the SVG 2 "Text layout algorithm → Position on path" step, at https://www.w3.org/TR/SVG2/text.html#TextpathLayoutRules (fetched from `https://www.w3.org/TR/SVG2/text.html`):

> Let **advance** = the advance of the typographic character corresponding to character *k*.
> Let **(x, y)** and **angle** be the position and angle in `result[index]`.
> Let **mid** be a coordinate value: → true (horizontal): **mid is x + advance / 2 + offset**
> If path is not a closed subpath and **mid < 0 or mid > length**, set the "hidden" flag of `result[index]` to true.
> Let **point** be the position and **t** be the unit vector tangent to the point *mid* distance along path.
> Let **n** be the normal unit vector pointing in the direction **t + 90°**.
> Let **o** be the horizontal distance from the vertical center line of the glyph to the alignment point.
> Then set the position in `result[index]` to **point − o×t + y×n**.
> Let **r** be the angle from the positive x-axis to the tangent. Set the angle value in `result[index]` to **angle + r**.

That is the whole thing. Written out:

```
s_i   = x_i + advance_i/2 + startOffset          // arclength of glyph MIDPOINT
(P, t) = pathAt(s_i)                              // point + unit tangent
n      = (-t.y, t.x)                              // t rotated +90° algebraically
pos_i  = P - (advance_i/2)*t + y_i*n              // glyph ORIGIN (baseline-left)
theta_i = atan2(t.y, t.x)
```

**Sign convention gotcha:** SVG is y-down. `n = (−t.y, t.x)` points to the **right-hand side of travel**, which is *below* a left-to-right path. Positive `y`/`dy` moves the label down. To float a label **above** a river running left-to-right, use a **negative** perpendicular offset. Verify with the degenerate case: `t = (1,0)` ⇒ `n = (0,1)` ⇒ `+y·n` adds to screen-y = downward. Blink does exactly this (`info.y = point.y * scale + *info.y`).

## 1.2 Mid-glyph vs left-edge anchoring — mid-glyph is correct

SVG 1.1 §10.13.3 (https://www.w3.org/TR/SVG11/text.html#TextOnAPath) spells out *why*, in a way SVG 2 compressed away:

> 2. Determine the glyph's **charwidth** …
> 3. Determine the point on the curve which is charwidth distance along the path from the startpoint-on-the-path for this glyph … This point is the **endpoint-on-the-path**.
> 4. Determine the **midpoint-on-the-path**, which is the point on the path which is "halfway" … between the startpoint-on-the-path and the endpoint-on-the-path.
> 5. Determine the **glyph-midline**, which is the vertical line in the glyph's coordinate system that goes through the glyph's x-axis midpoint.
> 6. Position the glyph such that **the glyph-midline passes through the midpoint-on-the-path and is perpendicular to the line through the startpoint-on-the-path and the endpoint-on-the-path**.
> 8. For each subsequent glyph, set a new startpoint-on-the-path as the previous endpoint-on-the-path…

**Why mid-glyph and not left-edge:** the glyph is a *rigid* box being mapped onto a *curved* line. Only one point of the box can be exact. If you anchor the left edge and rotate by the tangent at the left edge, the glyph's right edge swings off the curve by an error proportional to `advance × (1 − cos Δθ)` plus a tangential drift — the error is **one-sided and accumulates visibly**, so on a concave curve letters collide and on a convex one they gap. Anchoring the midpoint and rotating by the *chord* direction between the glyph's start and end split-points makes the error **symmetric about the glyph center** and halves its magnitude; the glyph's two corners deviate equally in opposite directions. It also makes the placement independent of text direction (RTL advances are negative; `x + advance/2` still lands on the visual center). Critically, the spec's step 8 says the *advance chain* still runs edge-to-edge along the path — mid-glyph anchoring is a rendering-time centering, not a change to the advance accumulation.

So the accumulation is: **run the pen in flat 1-D text space, then map each glyph's midpoint**.

```
x = 0
for i in glyphs:
    x_left[i] = x
    x += advance[i] + kern(i, i+1) + letterSpacing
s_i = startOffset + x_left[i] + advance[i]/2
```

Not `s_i = s_0 + Σadvance_j + advance_i/2` computed from a *curved* running total — the 1-D layout is done first and mapped afterwards. This matters because kerning and letter-spacing are 1-D quantities.

**Confirmed in three independent implementations:**

- **Blink** — `third_party/blink/renderer/core/layout/svg/svg_text_layout_algorithm.cc`, `SvgTextLayoutAlgorithm::PositionOnPath()` (https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_layout_algorithm.cc):
  ```cpp
  const float mid = (char_offset + info.inline_size / 2) / scaling_factor + offset;
  ...
  PathPositionMapper::PositionType position_type =
      path_mapper->PointAndNormalAtLength(mid, point_tangent);
  if (position_type != PathPositionMapper::kOnPath) { info.hidden = true; }
  point_tangent.tangent_in_degrees += info.rotate.value_or(0.0f);
  info.rotate = point_tangent.tangent_in_degrees;
  ```
- **Mapbox GL JS** — `src/symbol/quads.js` (https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v2.15.0/src/symbol/quads.js):
  ```js
  const halfAdvance = positionedGlyph.metrics.advance * positionedGlyph.scale / 2;
  const glyphOffset = alongLine ?
      [positionedGlyph.x + halfAdvance, positionedGlyph.y] :
      [0, 0];
  ...
  const x1 = (metrics.left - rectBuffer) * positionedGlyph.scale - halfAdvance + builtInOffset[0];
  ```
  `positionedGlyph.x` is the pen-left position from shaping; `+ halfAdvance` makes it the midpoint; the quad is then built back-shifted by `− halfAdvance` so the glyph is drawn centered on the placed point.
- **opentype.js** — `Font.prototype.forEachGlyph`, `src/font.mjs` (https://raw.githubusercontent.com/opentypejs/opentype.js/master/src/font.mjs), the canonical 1-D pen loop:
  ```js
  const fontScale = 1 / this.unitsPerEm * fontSize;
  for (let i = 0; i < glyphs.length; i += 1) {
      callback.call(this, glyph, x, y, fontSize, options);
      if (glyph.advanceWidth) { x += glyph.advanceWidth * fontScale; }
      if (options.kerning && i < glyphs.length - 1) {
          const kerningValue = kerningLookups ?
              this.position.getKerningValue(kerningLookups, glyph.index, glyphs[i+1].index) :
              this.getKerningValue(glyph, glyphs[i + 1]);
          x += kerningValue * fontScale;
      }
      if (options.letterSpacing) { x += options.letterSpacing * fontSize; }
      else if (options.tracking)  { x += (options.tracking / 1000) * fontSize; }
  }
  ```
  Note the two tracking unit conventions: `letterSpacing` is **em**, `tracking` is **1/1000 em** (the Adobe/InDesign unit). Kerning: `font.getKerningValue(left, right)` prefers GPOS (`position.defaultKerningTables`) and falls back to the legacy `kern` table (`this.kerningPairs[l + ',' + r] || 0`).

## 1.3 Arc-length parameterization + binary search

Build once per polyline, then every glyph lookup is O(log n).

```ts
// cumulative length table
type ArcTable = { pts: {x:number,y:number}[]; cum: Float64Array; total: number };

function buildArcTable(pts: {x:number,y:number}[]): ArcTable {
  const cum = new Float64Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i-1] + Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  }
  return { pts, cum, total: cum[pts.length - 1] };
}

// map arclength s -> point + unit tangent
function pathAt(T: ArcTable, s: number) {
  if (s < 0 || s > T.total) return null;              // spec: glyph is HIDDEN, not clamped
  // binary search: largest i with cum[i] <= s
  let lo = 0, hi = T.cum.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T.cum[m] <= s) lo = m; else hi = m - 1; }
  const i = Math.min(lo, T.pts.length - 2);
  const a = T.pts[i], b = T.pts[i+1];
  const segLen = T.cum[i+1] - T.cum[i];
  const t = segLen > 0 ? (s - T.cum[i]) / segLen : 0;
  const dx = b.x - a.x, dy = b.y - a.y;
  const inv = 1 / (Math.hypot(dx, dy) || 1);
  return { x: a.x + dx*t, y: a.y + dy*t, tx: dx*inv, ty: dy*inv, theta: Math.atan2(dy, dx) };
}
```

Reference TypeScript implementation with the same shape (cumulative `partial_lengths` + linear scan; swap in a binary search for long paths): `svg-path-properties`, https://raw.githubusercontent.com/rveciana/svg-path-properties/master/src/svg-path-properties.ts

```ts
private partial_lengths: number[] = []
private getPartAtLength = (fractionLength: number) => {
  if (fractionLength < 0) fractionLength = 0
  else if (fractionLength > this.length) fractionLength = this.length
  let i = this.partial_lengths.length - 1
  while (this.partial_lengths[i] >= fractionLength && i > 0) { i-- }
  i++
  return { fraction: fractionLength - this.partial_lengths[i - 1], i }
}
public getPointAtLength   = (l) => this.functions[this.getPartAtLength(l).i].getPointAtLength(...)
public getTangentAtLength = (l) => this.functions[this.getPartAtLength(l).i].getTangentAtLength(...)
```
and its exact per-segment tangent (`src/linear.ts`, same repo):
```ts
public getTangentAtLength = (_: number): Point => {
  const module = Math.hypot(this.x1 - this.x0, this.y1 - this.y0)
  return { x: (this.x1 - this.x0) / module, y: (this.y1 - this.y0) / module }
}
```

Blink's equivalent is `PathPositionMapper` in `layout_svg_text_path.cc` (https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/layout_svg_text_path.cc) — note it returns a tri-state, not a clamp:
```cpp
PathPositionMapper::PositionType PathPositionMapper::PointAndNormalAtLength(
    float length, PointAndTangent& point_and_tangent) {
  if (length < 0)            return kBeforePath;
  if (length > path_length_) return kAfterPath;
  point_and_tangent = position_calculator_.PointAndNormalAtLength(length);
  return kOnPath;
}
```

**For splines:** don't try to invert arc length analytically. Flatten each Bézier to a polyline at a tolerance (or fixed subdivision — `svg-path-properties` uses Legendre-Gauss quadrature for exact length plus a lookup for the inverse) and run the table above. For a fantasy map generator, flattening at ~0.25 px chord tolerance is plenty and makes tangents free.

## 1.4 The SVG transform sequence

The transform is `translate(pathPoint) · rotate(θ) · translate(−advance/2, perpOffset)`. Blink builds precisely this in `FragmentItem::BuildSvgTransformForTextPath()` (https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/inline/fragment_item.cc):

```cpp
// For non-<textPath>:  length-adjust * translate(x, y) * rotate() * translate(-x, -y)
// For <textPath>:      translate(x, y) * rotate() * length-adjust * translate(-x, -y)
AffineTransform transform;
transform.Rotate(svg_data.angle);
// https://svgwg.org/svg2-draft/text.html#TextpathLayoutRules
// The rotation should be about the center of the baseline.
float x = svg_data.rect.x();
float y = svg_data.rect.y();
case WritingMode::kHorizontalTb:
  y += font_data->GetFontMetrics().FixedAscent(font_baseline);
  transform.Translate(-svg_data.rect.width() / 2, svg_data.baseline_shift);
  break;
transform.PreConcat(length_adjust);
transform.SetE(transform.E() + x);
transform.SetF(transform.F() + y);
transform.Translate(-x, -y);
```

Emitting it per glyph in SVG — **rotation is about the glyph's baseline origin**, so translate first, rotate second, then back off half the advance:

```xml
<text transform="translate(PX,PY) rotate(THETA_DEG)">
  <tspan x="-ADV/2" y="PERP">M</tspan>
</text>
```
or equivalently, one attribute per glyph:
```xml
<text x="PX" y="PY" transform="rotate(THETA_DEG PX PY)" dx="-ADV/2" dy="PERP">M</text>
```
`rotate(a cx cy)` is shorthand for `translate(cx,cy) rotate(a) translate(-cx,-cy)` — same thing, one node. `THETA_DEG = theta * 180/Math.PI` with `theta = Math.atan2(dy, dx)`; SVG's `rotate()` takes **degrees**, and positive is clockwise on screen because of y-down, which matches `atan2` in the same y-down space. No sign flip needed as long as you compute `atan2` from raw SVG coordinates.

Baseline shift: apply it as `dy` **inside** the rotated frame (as Blink does with `baseline_shift`), not as a pre-rotation offset — otherwise the offset won't stay perpendicular to the curve.

## 1.5 Mapbox's per-glyph walk along a line

`placeGlyphAlongLine` in `src/symbol/projection.js` (https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v2.15.0/src/symbol/projection.js) — this is the "walk from the anchor outward" variant, useful because it costs O(segments touched) rather than O(log n) per glyph and naturally handles bidirectional placement from a center anchor:

```js
let dir = combinedOffsetX > 0 ? 1 : -1;
let angle = 0;
if (flip) { dir *= -1; angle = Math.PI; }
if (dir < 0) angle += Math.PI;
const absOffsetX = Math.abs(combinedOffsetX);
while (distanceToPrev + currentSegmentDistance <= absOffsetX) {
    currentIndex += dir;
    if (currentIndex < lineStartIndex || currentIndex >= lineEndIndex) return null;  // no room
    prev = current; ...
    distanceToPrev += currentSegmentDistance;
    currentSegmentDistance = vec3.distance(prev, current);
}
const segmentInterpolationT = (absOffsetX - distanceToPrev) / currentSegmentDistance;
const labelPlanePoint = vec3.scaleAndAdd([], prev, prevToCurrent, segmentInterpolationT);
if (lineOffsetY) {   // perpendicular baseline offset
    const offsetDir = vec3.cross([], axisZ, prevToCurrent);
    vec3.normalize(offsetDir, offsetDir);
    vec3.scaleAndAdd(labelPlanePoint, labelPlanePoint, offsetDir, lineOffsetY * dir);
}
const segmentAngle = angle + Math.atan2(diffY, diffX);
```

Note `angle += Math.PI` when walking backwards from the anchor — that's how you keep glyphs on the left half of the label upright.

## 1.6 The max-angle constraint (this is the one that saves you)

**`text-max-angle` default = 45 degrees.** Verified directly from the style-spec source of truth, `src/style-spec/reference/v8.json` (https://raw.githubusercontent.com/mapbox/mapbox-gl-js/main/src/style-spec/reference/v8.json), `layout_symbol`:

| property | default | units | doc |
|---|---|---|---|
| `text-max-angle` | **45** | degrees | "Maximum angle change between adjacent characters." |
| `text-letter-spacing` | **0** | ems | "Text tracking amount." |
| `symbol-placement` | `point` | — | values `point`, `line`, `line-center` |
| `symbol-spacing` | **250** | pixels | "Distance between two symbol anchors." |
| `text-padding` | **2** | pixels | collision box padding |
| `text-keep-upright` | **true** | — | "If true, the text may be flipped vertically to prevent it from being rendered upside-down." |
| `icon-keep-upright` | **false** | — | |

Same values are documented at https://docs.mapbox.com/style-spec/reference/layers/.

The doc string ("between adjacent characters") is **misleading**. The implementation is a *sliding window over arclength summing absolute turning angles* — `src/symbol/check_max_angle.js` (https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v2.15.0/src/symbol/check_max_angle.js), reproduced nearly in full because it is directly portable:

```js
function checkMaxAngle(line, anchor, labelLength, windowSize, maxAngle) {
    if (anchor.segment === undefined) return true;          // horizontal labels always pass
    let p = anchor, index = anchor.segment + 1, anchorDistance = 0;
    // move backwards along the line to the first segment the label appears on
    while (anchorDistance > -labelLength / 2) {
        index--;
        if (index < 0) return false;                        // not enough room before the start
        anchorDistance -= line[index].dist(p);
        p = line[index];
    }
    anchorDistance += line[index].dist(line[index + 1]);
    index++;
    const recentCorners = [];
    let recentAngleDelta = 0;
    while (anchorDistance < labelLength / 2) {
        const prev = line[index - 1], current = line[index], next = line[index + 1];
        if (!next) return false;                            // not enough room before the end
        let angleDelta = prev.angleTo(current) - current.angleTo(next);
        angleDelta = Math.abs(((angleDelta + 3 * Math.PI) % (Math.PI * 2)) - Math.PI);   // wrap to [0, pi]
        recentCorners.push({ distance: anchorDistance, angleDelta });
        recentAngleDelta += angleDelta;
        while (anchorDistance - recentCorners[0].distance > windowSize) {
            recentAngleDelta -= recentCorners.shift().angleDelta;
        }
        if (recentAngleDelta > maxAngle) return false;
        index++;
        anchorDistance += current.dist(next);
    }
    return true;
}
```

**The window size** — `src/symbol/get_anchors.js` (https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v2.15.0/src/symbol/get_anchors.js):
```js
function getAngleWindowSize(shapedText, glyphSize, boxScale) {
    return shapedText ? 3 / 5 * glyphSize * boxScale : 0;
}
```
with `glyphSize = ONE_EM` and `ONE_EM = 24` (`src/symbol/one_em.js`: `export default 24;`), and `boxScale = textMaxBoxScale = bucket.tilePixelRatio * textMaxSize / glyphSize` (`src/symbol/symbol_layout.js`).

Substituting: `windowSize = (3/5) × 24 × (textMaxSize/24) = 0.6 × textMaxSize` px. **The window is 0.6 em.**

> **Net rule, in units you can use directly:** slide a 0.6-em-long window along the polyline across the label's footprint (`±labelLength/2` around the anchor); the **sum of absolute turning angles inside any such window must not exceed 45°**. Also from `symbol_layout.js`: `textMaxAngle = degToRad(layout.get('text-max-angle'))` = **0.7853981634 rad**.

At 16 px type: window = **9.6 px**, budget **45°**. At 32 px: window = 19.2 px, same 45°. Larger type tolerates proportionally gentler curves — which is the right behavior.

Mapnik uses a stricter per-character rule instead: **`max-char-angle-delta` default 22.5 degrees**, from `mapnik-reference` `3.0.22/reference.json` (https://raw.githubusercontent.com/mapnik/mapnik-reference/master/3.0.22/reference.json): *"The maximum angle change, in degrees, allowed between adjacent characters in a label. This value internally is converted to radians to the default is 22.5\*math.pi/180.0. The higher the value the fewer labels will be placed around sharp corners."* OSM Carto overrides it to **15** for bay/strait line labels (`style/water.mss` line 440: `text-max-char-angle-delta: 15;`).

**Recommendation for a fantasy map:** use Mapbox's windowed rule at 45° / 0.6 em as the *primary* filter and add Mapnik's 15–22.5° per-adjacent-glyph cap as a secondary guard. The windowed rule catches "many small turns that add up"; the per-char rule catches "one nasty kink".

---

# 2. `<textPath>` vs manual per-glyph placement

## 2.1 Attribute semantics (from spec text)

`startOffset` — https://www.w3.org/TR/SVG2/text.html §11.8.2:
> If a `<length>` other than a percentage is given, then the `startOffset` represents a distance along the path measured in the current user coordinate system for the `textPath` element. If a percentage is given, then the `startOffset` represents a percentage distance along the entire path. Thus, `startOffset="0%"` indicates the start point of the path and `startOffset="100%"` indicates the end point of the path.
> **Negative values and values larger than the path length (e.g. 150%) are allowed.** … Any typographic characters with mid-points that are not on the path are not rendered.
> Value: `<length-percentage> | <number>`; initial value **0**.

SVG 2 explicitly notes the browsers are wrong here:
> "The bottom path should show only 'path.' on the left side of the path. **Chrome and Safari both do not handle offsets outside the range 0% to 100%.** Chrome bug https://bugs.chromium.org/p/chromium/issues/detail?id=476554"

`method` — `align | stretch`, **initial `align`**:
> A value of `align` indicates that the typographic character should be rendered using simple 2×3 matrix transformations such that there is no stretching/warping of the typographic characters. …
> A value of `stretch` indicates that the typographic character outlines will be converted into paths, and then all end points and control points will be adjusted to be along the perpendicular vectors from the path, thereby stretching and possibly warping the glyphs.

`spacing` — `auto | exact`, **initial `exact`**:
> `exact`: characters rendered exactly according to the spacing rules in Text on a path layout rules. `auto`: the user agent should use text-on-a-path layout algorithms to adjust the spacing … to achieve visually appealing results.

`side` — `left | right`, **initial `left`**, SVG 2 only:
> Determines the side of the path the text is placed on (relative to the path direction). **Specifying a value of `right` effectively reverses the path.**

Identical `method`/`spacing` defaults in SVG 1.1 (https://www.w3.org/TR/SVG11/text.html): *"If the attribute is not specified, the effect is as if a value of `align` were specified"* / *"…as if a value of `exact` were specified."*

## 2.2 Browser support — the actual numbers

From MDN browser-compat-data, `svg/elements/textPath.json` (https://raw.githubusercontent.com/mdn/browser-compat-data/main/svg/elements/textPath.json):

| feature | Chrome | Firefox | Safari |
|---|---|---|---|
| `textPath` element | 1 | 2 | 3.1 |
| `startOffset` | 1 | 20 | 3.1 |
| `spacing` (attr parsed) | 1 | 20 | 3.1 |
| `textLength` | 1 | 2 | 3.1 |
| `href` (non-xlink) | **50** | 2 | **12.1** |
| **`path`** | **false** | **61** | **false** |
| **`side`** | **false** | **61** | **false** |
| `method` | *not tracked at all* | | |

BCD note on `href`: *"Only accepts references to path elements. Basic shapes (rect, circle, ellipse, line, polygon, polyline) won't work."* (Chrome and Safari.)

**`side` is confirmed unimplemented in Blink from the source itself** — `svg_text_layout_algorithm.cc` carries the admission inline:
```cpp
// 5.1.2.2. If the 'side' attribute of the 'textPath' element is
// 'right', then reverse path.
// ==> We don't support 'side' attribute yet.
```
and `svg_text_path_element.cc` / `.h` register only `startOffset`, `method`, `spacing`, `path` — there is no `kSideAttr`.

**`method="stretch"` — confirmed inert in Chrome.** `svg_text_path_element.h` declares the enums (`kSVGTextPathMethodAlign`, `kSVGTextPathMethodStretch`, `kSVGTextPathSpacingAuto`, `kSVGTextPathSpacingExact`) and `svg_text_path_element.cc` parses them into DOM-exposed `SVGAnimatedEnumeration`s, but `svg_text_layout_algorithm.cc` **never reads `method_` or `spacing_`** — grepping the layout algorithm for `MethodType|Stretch` returns nothing. So `method`/`spacing` are DOM-only in Chrome: readable via `SVGTextPathElement.method.baseVal`, zero rendering effect. The spec sanctions this by making it optional: *"The user agent is free to make any additional adjustments to mid necessary to ensure high quality typesetting due to a `spacing` value of 'auto' or a `method` value of 'stretch'."*

Also worth knowing, Blink declines another spec branch:
```cpp
// ==> Major browsers don't support the special handling for closed paths.
```
So the SVG 2 closed-subpath wrapping rules (text looping a circle, `mid = mid mod length`) do not work in practice.

## 2.3 Known pitfalls, each with its mechanism

1. **Text silently disappears when the path is too short.** This is *spec-mandated*, not a bug: "Glyphs whose midpoint-on-the-path are off either end of the path are not rendered" (SVG 1.1 §10.13.3). In Blink: `if (position_type != PathPositionMapper::kOnPath) { info.hidden = true; }`. There is no warning, no partial render, no clamp — a label 1 px too long for its river vanishes entirely. **You cannot detect this from the DOM cheaply.** With manual placement you know the arclength budget before you emit anything.
2. **letter-spacing breaks textPath in Firefox.** Reported at https://support.mozilla.org/en-US/questions/1301960 — with `text-anchor="middle"` + `startOffset="50%"`, adding `letter-spacing`/`word-spacing` makes Firefox rotate the text off its expected position; the same page renders correctly in other browsers. Since letter-spacing is exactly the effect you want for map labels, this alone is a strong argument for manual placement.
3. **`textLength` is applied inconsistently across browsers** and per the same thread must be specified in multiple places to work cross-browser. In SVG 2 it redistributes `δ = textLength − (b − a)` as `small-delta = δ/n` per character (§ "Adjust positions"), and Blink applies it as a *scale* matrix (`BuildSvgTransformForLengthAdjust`, `length_adjust_scale`), which composes differently for textPath (`translate * rotate * length-adjust * translate⁻¹`) than for straight text (`length-adjust * translate * rotate * translate⁻¹`) — note the operand order actually differs, per the comment in `fragment_item.cc`.
4. **`dominant-baseline`** is fine for the common values — `auto`, `alphabetic`, `central`, `middle`, `hanging`, `ideographic`, `mathematical` are Chrome 1 / Firefox 1 / Safari 4. But `text-top` and `text-bottom` are **Firefox 149 only**, false in Chrome and Safari (https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/dominant-baseline.json). Avoid them.
5. **Path direction determines text direction, and you cannot flip it portably.** The path is "stretched out into a hypothetical horizontal line segment such that the start of the path is mapped to the left" (SVG 1.1 §10.13.3). A river digitized east-to-west renders its label backwards-reading. The spec fix is `side="right"` — **unavailable in Chrome and Safari**. The only portable fix is to reverse the path data yourself, which means you are already doing geometry work.
6. **`pathLength` rescales `startOffset` percentages.** Blink: `offset_scale = SVGGeometryElement::PathLengthScaleFactor(computed_path_length, author_path_length); path_start_offset *= offset_scale;`. If a path carries `pathLength`, your percentage offsets mean something different than you think.
7. **`path=` attribute is Firefox-only**, so you must materialize a `<path>` element with an id and reference it — extra DOM, and `href` needs Chrome 50+/Safari 12.1+ or the `xlink:href` fallback.

## 2.4 Verdict for a procedural fantasy map generator

**Do manual per-glyph placement.** The decisive reasons, in order: (a) you need letter-spacing, which is broken with textPath in Firefox; (b) you need "never upside down", which requires `side` or path reversal, and `side` doesn't exist in Chrome/Safari; (c) silent total disappearance on short paths is unacceptable in a generator where you can't eyeball every output — you want to *measure* the arclength budget and pick a different sub-segment or a smaller size; (d) you already need the arclength table for sub-segment selection (§3), so the marginal cost of doing placement yourself is near zero; (e) manual placement gives you per-glyph collision boxes for free, which you need for label deconfliction anyway.

Cost of manual: you lose text selection/copy and accessibility of the text run. Mitigate with `<title>`/`aria-label` on the group, and keep the full string in a `<desc>` or a hidden `<text>`.

---

# 3. Choosing the best sub-segment of a long polyline

## 3.1 Straightness metrics

Given a candidate window `[s0, s1]` of arclength `L = s1 − s0`, with sampled points `p_0..p_m` and chord `C = |p_m − p_0|`:

| metric | formula | ideal | interpretation |
|---|---|---|---|
| **Sinuosity** | `σ = L / C` | 1.0 | classic river metric; `1/σ = C/L` is the "straightness index" ∈ (0,1] |
| **Total absolute turning** | `Θ = Σ \|Δθ_i\|`, `Δθ_i = wrap(θ_{i+1} − θ_i)` | 0 | catches S-curves that sinuosity misses (a symmetric S can have σ ≈ 1) |
| **Max deviation from chord** | `H = max_i dist(p_i, line(p_0,p_m))` | 0 | Hausdorff-ish; this is exactly the Douglas–Peucker error measure |
| **Curvature integral** | `∫κ ds ≈ Σ \|Δθ_i\|` | 0 | discretely identical to Θ; use `∫κ² ds ≈ Σ Δθ_i²/Δs_i` to penalize sharp kinks superlinearly |
| **Signed turning** | `Θ_s = Σ Δθ_i` | — | `\|Θ_s\| ≪ Θ` ⟹ S-curve; `\|Θ_s\| ≈ Θ` ⟹ consistent arc (fine for text, actually pretty) |

Critical point: **use Θ (unsigned) not Θ_s**, and prefer a **windowed max of Θ** over a global sum, exactly as Mapbox does. A 400-px river reach with 40° of total gentle turn is perfectly labelable; the same 40° concentrated into one 8-px kink is not. Only the windowed form distinguishes them.

Also note `σ` and `H` are **blind to kinks near the endpoints being cancelled by the chord**. Θ is the robust one. Use `σ`/`H` as cheap pre-filters.

## 3.2 Sliding window algorithm

```ts
type Cand = { s0: number; s1: number; score: number };

function bestSubSegment(T: ArcTable, textWidth: number, opts: {
  step?: number; maxAngleDeg?: number; angleWindowEm?: number; fontSize: number;
}): Cand | null {
  const L = textWidth;                                  // window length == required text width
  const step = opts.step ?? L / 8;                       // MERL uses width/8
  const maxAngle = (opts.maxAngleDeg ?? 45) * Math.PI / 180;
  const angleWindow = (opts.angleWindowEm ?? 0.6) * opts.fontSize;
  let best: Cand | null = null;

  for (let s0 = 0; s0 + L <= T.total; s0 += step) {
    const w = windowStats(T, s0, s0 + L, angleWindow);
    if (w.maxWindowedTurn > maxAngle) continue;          // hard reject (Mapbox rule)
    // lower is better
    const sinuosity   = L / Math.max(w.chord, 1e-9);     // >= 1
    const centeredness= Math.abs(2 * ((s0 + L/2) / T.total) - 1);   // MERL: |2l - 1|
    const score = 1.0 * (sinuosity - 1)
                + 1.0 * (w.totalTurn / maxAngle)
                + 0.5 * (w.maxDeviation / (0.5 * opts.fontSize))
                + 3.0 * centeredness;                    // MERL weights Centeredness at 3
    if (!best || score < best.score) best = { s0, s1: s0 + L, score };
  }
  return best;
}
```

**Window length = required text width.** That is not a heuristic — it is what the constraint *is*. Compute `textWidth = Σ(advance_i) + (n−1)·letterSpacing + Σkern` in the same user units as the path, using the 1-D pen loop from §1.2, and only then go looking for a window.

Step size: **MERL uses `inc = width/8`** (see §3.3). That's 8× oversampling relative to the label; finer buys little, coarser starts missing the good reach. `step = L/8` is a well-tested default.

Fallback ladder when nothing passes (in order — this is what real renderers do):
1. Relax `maxAngle` (45° → 60°).
2. Reduce font size, which shrinks both `L` **and** the 0.6-em angle window — a double win, and the reason the 0.6-em window is defined in em rather than pixels.
3. Increase letter-spacing to *lengthen* the label onto a straighter but longer reach (rarely useful).
4. Place at the center regardless — Mapbox's literal fallback in `get_anchors.js`: *"The first attempt at finding anchors at which labels can be placed failed. Try again, but this time just try placing one anchor at the middle of the line."* → `anchors = resample(line, distance / 2, ...)`.
5. Drop the label.

Mapbox's own admission-control checks worth copying verbatim from `resample()`:
```js
if (x >= 0 && x < tileExtent && y >= 0 && y < tileExtent &&
        markedDistance - halfLabelLength >= 0 &&
        markedDistance + halfLabelLength <= lineLength) { ... }
```
i.e. reject any anchor whose label would overhang either end. And the label/spacing interaction:
```js
// Is the label long, relative to the spacing?
// If so, adjust the spacing so there is always a minimum space of `spacing / 4` between label edges.
if (spacing - labelLength < spacing / 4) { spacing = labelLength + spacing / 4; }
```

## 3.3 The published approach: Edmondson, Christensen, Marks & Shieber (1996)

**"A General Cartographic Labeling Algorithm"**, MERL Technical Report TR96-04, January 1996 — full text at **https://www.merl.com/publications/docs/TR96-04.pdf** (also https://dash.harvard.edu/entities/publication/73120378-7d90-6bd4-e053-0100007fdf3b). It covers line features explicitly and is directly implementable. Quoting §5.2 *"Candidate label positions for line features"*:

> 1. Generate multiple positions along the length of the line feature:
>    (a) Let *start* be the point at one end of the polyline.
>    (b) Let ***inc* be one eighth of *width*, the width of the label.**
>    (c) Repeat until *start* is less than *width* from the end of the polyline, measured as distance along the line:
>       i. Find a point *end* on the polyline that is a distance *width* from *start*.
>       ii. Generate two coincident positions with baselines that run from *start* to *end*; mark one "above", the other "below".
>       iii. Increment *start* by *inc*.
> 2. Adjust all generated candidate positions to achieve the ideal value for the *MinDist* metric by applying appropriate translations perpendicular to their baselines. …
> 3. If a line feature is shorter than its own label … pick a point at the center of the line feature and generate positions as if the given point were a point feature.
> 4. Score the generated positions according to all precomputable metrics — everything but *LabelOver*.
> 5. Delete all but the *k* best positions.
> **Typically, we use *k* = 32**, which is a good compromise …

The five line metrics (§4.3), with the paper's exact formulas:

- **Ideal offset distance**: **`δ = ascent/4 + thickness/2`** where *ascent* is baseline→cap-height and *thickness* is the rendered line width. This is the single most useful concrete number in the paper for a map generator — it makes the label float scale with both type size and river width.
- **Swath**: "an infinitely long strip which is perpendicular to the baseline and centered about the label. **The width of the swath is 20% greater than the width of the label.**" (i.e. 1.2 × label width — the analysis window is deliberately wider than the text.)
- **AveDist** = `(d − δ)² / δ²`, where `d` = (area between the swath line and the lower side of the skyline) ÷ (swath width). "We choose to let the borderline case be an average distance of either 0.0 or 2δ. We let AveDist grow as the square of the deviation from δ, since experiment has shown this to work better than a simple linear model."
- **MinDist** = `(d′ − δ)² / δ²`, `d′` = min distance between any point on the swath line and any point on the skyline.
- **Flatness** = `d″² / δ²` — **this is the straightness metric you want**: "we compute the deviation of the swath line from a straight line *L* that is parallel to the baseline and offset the ideal distance δ from it. We sum up the area between the swath line and *L*, then divide by the width of the swath. … In the ideal case, d″ is zero; we will pick the borderline case to be when d″ = δ." Note this is an **integrated area deviation normalized by window width** — a mean absolute deviation, more robust than max-deviation and cheaper than a curvature integral.
- **Centeredness** = **`|2l − 1|`** where `l = l₁/l₂`, `l₁` = arclength from one end to the point on the polyline nearest the label baseline's midpoint, `l₂` = total polyline length. 0 at center, 1 at either end.
- **Aboveness** = 0.0 if above, 1.0 if below — "Following Imhof, we prefer labels above the line."

And the empirically tuned weights, Table 1 (§4.5) — *"Suitable values for the weights were created intuitively and refined empirically"*:

| metric | weight |
|---|---|
| PointOver | 10 |
| **LineOver** | **15** |
| AreaOver | 10 |
| **LabelOver** | **40** |
| PointPos | 1 |
| **AveDist** | **1** |
| **Flatness** | **1** |
| MinDist | n/a (position generation guarantees perfect value) |
| **Centeredness** | **3** |
| **Aboveness** | **0.25** |
| AreaPos | 10 |

Two things to steal directly: **label–label overlap (40) is weighted 2.7× above line overlap (15)**, and **Centeredness (3) dominates Flatness (1) 3:1** — i.e. the paper's tuning says a centered label on a slightly curvier reach beats an off-center label on the straightest reach. That is a non-obvious calibration and it matches how good hand cartography looks.

**Other line-labeling literature:**
- Wolff & Strijk, **Map Labeling Bibliography**, http://i11www.iti.kit.edu/map-labeling/bibliography/ — maintained by Alexander Wolff with Tycho Strijk as major contributor; BibTeX plus per-entry .ps.gz/PDF links where authors permitted; follows GeomBib conventions. I could not find a line-feature-specific index within it.
- Wolff, Knipping, van Kreveld, Strijk & Agarwal, **"A simple and efficient algorithm for high-quality line labeling"**, in Atkinson & Martin (eds.), *Innovations in GIS VII: GeoComputation*, ch. 11, pp. 147–159, Taylor & Francis, 2000; earlier as EWCG'99 pp. 93–96 and GISRUK'99 pp. 146–150; tech report **UU-CS-2001-44**, Utrecht. Listed at https://i11www.iti.kit.edu/en/members/alexander_wolff/publications. **I could not retrieve the full text** — every PDF mirror I tried (`i11www.iti.kit.edu/~awolff/pub/wkksa-seahq-00.pdf`, `i11www.ira.uka.de`, `dspace.library.uu.nl`, `cs.uu.nl/research/techreps`) returned 404 or an error page. Its known contribution is the "candidate strip" refinement (progressively refined strips along the line) — treat that as unverified.
- Kakoulis & Tollis, **"Labeling Algorithms"**, ch. 15 of the *Handbook of Graph Drawing and Visualization*, https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/labeling.pdf — survey including line/edge labeling.
- **ArcGIS Pro Maplex "River placement"** style, https://pro.arcgis.com/en/pro-app/latest/help/mapping/text/label-using-the-river-placement-style-for-line-features.htm — described as: designed for "features with multiple curves and tight bends, like rivers"; it "generalizes the turns of a river and places the label following that smoother line", with **Centered curved** and **Offset curved** position options, and labels may span multiple bends. **Esri publishes no numeric parameters for it.** The "generalize first, then place" idea is worth copying: run Douglas–Peucker (or Chaikin smoothing) on the candidate window *before* computing tangents, so per-glyph angles come from the smoothed line, not from digitizing noise. Mapnik exposes exactly these two knobs: `simplify` (default **0.0**, "Simplify the geometries used for text placement by the given tolerance") and `smooth` (default **0.0**, "0 is no smoothing, 1 is fully smoothed. Values greater than 1 will produce wild, looping geometries") — https://raw.githubusercontent.com/mapnik/mapnik-reference/master/3.0.22/reference.json.

---

# 4. Flipping text so it's never upside down

Three real implementations, three different tests. Use the third.

## 4.1 Mapnik — cheap anchor-angle test

`src/text/placement_finder.cpp`, `simplify_upright()` (https://raw.githubusercontent.com/mapnik/mapnik/master/src/text/placement_finder.cpp):
```cpp
if (upright == text_upright_enum::UPRIGHT_AUTO) {
    angle = util::normalize_angle(angle);
    return std::abs(angle) > util::tau / 4 ? text_upright_enum::UPRIGHT_LEFT
                                           : text_upright_enum::UPRIGHT_RIGHT;
}
```
`util::tau / 4` = **π/2 = 90°**. So: **normalize the angle to (−π, π], flip if `|angle| > 90°`.** This is exactly the "angle of the chord, compare `|angle| > 90°`" test.

## 4.2 Mapnik — verification pass by counting upside-down glyphs

Same file, in `single_line_placement()`:
```cpp
unsigned upside_down_glyph_count = 0;
...
if (std::abs(angle) > util::tau / 4) { ++upside_down_glyph_count; }
...
if (upside_down_glyph_count > static_cast<unsigned>(layouts_.text().length() / 2)) {
    if (orientation == text_upright_enum::UPRIGHT_AUTO) {
        begin.restore();
        return single_line_placement(pp, real_orientation == text_upright_enum::UPRIGHT_RIGHT
                                           ? text_upright_enum::UPRIGHT_LEFT
                                           : text_upright_enum::UPRIGHT_RIGHT);
    }
    else if (orientation == UPRIGHT_LEFT_ONLY || orientation == UPRIGHT_RIGHT_ONLY) { return false; }
}
```
Matching the documented behavior of `upright` (default **`auto`**): *"By default when more than half of a label's characters are upside down the label is automatically flipped to keep it upright. … The 'left-only' or 'right-only' properties also force a given direction but will **discard** upside down text rather than trying to flip it."* Values: `auto | auto-down | left | right | left-only | right-only`.

## 4.3 Mapbox GL JS — chord of first-to-last *placed glyph*, with hysteresis

`src/symbol/projection.js`. This is the best of the three because it uses the chord between the actually-placed first and last glyphs (not the raw geometry), and it handles near-vertical flicker.

```js
const maxTangent = Math.tan(85 * Math.PI / 180);           // ≈ 11.4300523

function isInFlipRetainRange(dx, dy) {
    return dx === 0 || Math.abs(dy / dx) > maxTangent;     // within 5° of vertical
}

function requiresOrientationChange(writingMode, flipState, dx, dy) {
    if (writingMode === WritingMode.horizontal && Math.abs(dy) > Math.abs(dx)) {
        return {useVertical: true};                        // steeper than 45° -> vertical glyphs
    }
    if (writingMode === WritingMode.vertical) {
        return dy > 0 ? {needsFlipping: true} : null;
    }
    if (flipState !== FlipState.unknown && isInFlipRetainRange(dx, dy)) {
        return (flipState === FlipState.flipRequired) ? {needsFlipping: true} : null;
    }
    return dx < 0 ? {needsFlipping: true} : null;          // <-- THE TEST
}
```
Called as:
```js
let [x0, y0, z0] = firstAndLastGlyph.first.point;
let [x1, y1, z1] = firstAndLastGlyph.last.point;
[x0, y0] = project(x0, y0, z0, glCoordMatrix);
[x1, y1] = project(x1, y1, z1, glCoordMatrix);
const orientationChange = requiresOrientationChange(writingMode, flipState, (x1 - x0) * aspectRatio, y1 - y0);
```

So, precisely:
- `dx = (x_lastGlyph − x_firstGlyph) × aspectRatio`, `dy = y_lastGlyph − y_firstGlyph`, in **screen space after projection**.
- **`dx < 0` ⇒ flip.**
- `|dy| > |dx|` (steeper than 45°) ⇒ switch to the **vertical** writing-mode glyph set instead of flipping. `FlipState = {unknown: 0, flipRequired: 1, flipNotRequired: 2}`.
- **Hysteresis:** within **5° of vertical** (`|dy/dx| > tan 85°`), reuse last frame's decision rather than recomputing. Comment in source: *"Check in the glCoordinate space, the rough estimation of angle between the text line and the Y axis. If the angle if less or equal to 5 degree, then keep the text glyphs unflipped even if it is required."*
- Flipping is implemented by walking the line in reverse and adding π: `if (flip) { dir *= -1; angle = Math.PI; }` in `placeGlyphAlongLine`, plus `combinedOffsetX = flip ? offsetX - lineOffsetX : offsetX + lineOffsetX` so the perpendicular offset stays on the correct visual side.
- The whole thing is retried: `placeGlyphsAlongLine(..., false /*unflipped*/, ...)` and, if `needsFlipping`, again with `true /*flipped*/`.

## 4.4 What to implement

```ts
// theta of the chord across the actual label footprint [s0, s1], not the whole polyline
const A = pathAt(T, s0)!, B = pathAt(T, s1)!;
const dx = B.x - A.x, dy = B.y - A.y;

if (dx < 0) reversePath();                 // primary test  (Mapbox)
// equivalently: Math.abs(Math.atan2(dy, dx)) > Math.PI / 2      (Mapnik)

// verification pass after per-glyph placement:
const upsideDown = glyphs.filter(g => Math.abs(normalizeAngle(g.theta)) > Math.PI / 2).length;
if (upsideDown > glyphs.length / 2) reverseAndReplace();        // Mapnik auto-upright
```
Use the **mean tangent** rather than the chord only if your window can double back (`Σ t_i` over the window, then test `Σt_i.x < 0`); for windows that already passed a 45°-per-0.6em turn filter the chord and the mean tangent agree, and the chord is cheaper and more stable. `normalizeAngle` must wrap to (−π, π] — Mapbox does it as `Math.abs(((angleDelta + 3 * Math.PI) % (Math.PI * 2)) - Math.PI)`.

Reversing the path is the correct primitive (it is literally what SVG 2's `side="right"` is defined to do: *"Specifying a value of `right` effectively reverses the path"*). Do **not** rotate each glyph by 180° in place — that reverses reading order.

---

# 5. Letter-spacing / tracking — real numbers

## 5.1 How the accumulation works

Mapbox, `src/symbol/shaping.js` (https://raw.githubusercontent.com/mapbox/mapbox-gl-js/v2.15.0/src/symbol/shaping.js):
```js
x += metrics.advance * sectionScale + spacing;   // applied after EVERY glyph
...
const lineLength = x - spacing;                  // then one trailing gap removed
```
with, in `symbol_layout.js`:
```js
const spacing = layout.get('text-letter-spacing').evaluate(feature, {}, canonical) * ONE_EM;   // ONE_EM = 24
```
So: **spacing_px = letterSpacing_em × fontSize**, added after every glyph, and the trailing gap subtracted from the measured width. Get this right or your centering is off by half a gap.

Note also: **Mapbox applies no kerning at all** — `getGlyphAdvance` returns `glyph.metrics.advance * section.scale + spacing`, full stop. SDF atlas glyphs, advance widths only. For a fantasy map at display sizes you probably *do* want kerning (via `opentype.js` `getKerningValue`), but be aware Mapnik turns ligatures off once spacing is nonzero: *"Typographic ligatures are turned off when this value is greater than zero"* (mapnik-reference, `character-spacing`). Do the same — tracked-out ligatures look broken.

Worked example: "MISTWOOD RIDGE", 14 glyphs, 16 px, `letterSpacing = 0.2 em` ⇒ `spacing = 3.2 px`. Added width = 13 × 3.2 = **41.6 px** (14 gaps added, one subtracted). That is a ~30% length increase on a typical uppercase string — budget for it when picking the window in §3.

## 5.2 Verified values from shipping map styles

| style | layer | placement | `text-letter-spacing` (em) | notes |
|---|---|---|---|---|
| **Mapbox Bright v9** | `marine_label_line_1..4` | **line** | **0.2** | oceans/seas; sizes 11→22 px by zoom |
| Mapbox Bright v9 | `marine_label_point_1..4` | point | **0.2** | |
| Mapbox Bright v9 | `place_label_other` | point | **0.1** | `text-transform: uppercase` |
| Mapbox Bright v9 | `country_label_1..4` | point | *(none)* | uppercase, **no tracking** |
| Mapbox Bright v9 | `road_label`, `water_label`, `poi_label_*` | line/point | *(none)* | |
| **Mapbox Basic v9** | `road_major_label` | **line** | **0.1** | |
| **OpenMapTiles OSM Bright** | `waterway-name` | **line** | **0.2** | size 14 |
| OSM Bright | `water-name-lakeline` | line | **0.2** | |
| OSM Bright | `water-name-ocean`, `water-name-other` | point | **0.2** | |
| OSM Bright | `place-other`, `place-state` | point | **0.1** | |
| **Klokantech Basic** | `road_major_label` | line | **0.1** | |
| **osm-liberty** | `place_other` | point | **0.1** | uppercase |
| **Protomaps basemaps** (TS) | `water_waterway_label` | **line** | **0.2** | river/stream, size 12, italic |
| Protomaps | `water_label_ocean` | point | **0.1** | uppercase, size 10→12 |
| Protomaps | `earth_label_islands` | point | **0.1** | size 10 |
| Protomaps | `water_label_lakes` | point | **0.1** | |
| Protomaps | `places_subplace` | point | **0.1** | uppercase |

Sources: https://raw.githubusercontent.com/mapbox/mapbox-gl-styles/master/styles/bright-v9.json, https://raw.githubusercontent.com/mapbox/mapbox-gl-styles/master/styles/basic-v9.json, https://raw.githubusercontent.com/openmaptiles/osm-bright-gl-style/master/style.json, https://raw.githubusercontent.com/openmaptiles/klokantech-basic-gl-style/master/style.json, https://raw.githubusercontent.com/maputnik/osm-liberty/gh-pages/style.json, https://raw.githubusercontent.com/protomaps/basemaps/main/styles/src/base_layers.ts

Protomaps river label, verbatim, as a directly copyable target:
```ts
{
  id: "water_waterway_label", type: "symbol", "source-layer": "water",
  minzoom: 13, filter: ["in", "kind", "river", "stream"],
  layout: {
    "symbol-placement": "line",
    "text-font": [t.italic || "Noto Sans Italic"],
    "text-size": 12,
    "text-letter-spacing": 0.2,
  },
  paint: { "text-color": t.ocean_label, "text-halo-color": t.water, "text-halo-width": 1 },
}
```

**The convergent finding across five independently authored styles: water features on lines get 0.2 em; everything else that gets tracked at all gets 0.1 em; roads and POIs get 0.**

## 5.3 OSM Carto (Mapnik/CartoCSS)

I fetched every stylesheet listed in `project.mml` (`style.mss`, `fonts.mss`, `shapefiles.mss`, `landcover.mss`, `water.mss`, `water-features.mss`, `roads.mss`, `power.mss`, `placenames.mss`, `buildings.mss`, `stations.mss`, `amenity-points.mss`, `ferry-routes.mss`, `aerialways.mss`, `admin.mss`, `addressing.mss`, `golf.mss`, `tourism.mss`) from https://github.com/gravitystorm/openstreetmap-carto (branch `master`, files live under `style/`).

**`text-character-spacing` appears exactly once in the entire stylesheet:**
```
style/placenames.mss:47:    text-character-spacing: 0.5;
```
in the `#country-names` block, whose `text-size` ramps 10 → 15 px across z3–z10. Mapnik's `character-spacing` is in **pixels**, not em (mapnik-reference: *"Horizontal spacing adjustment between characters in pixels"*, default **0.0**). So OSM Carto's only tracking is **0.5 px at 10–15 px type = 0.033–0.05 em**, on country labels only.

**Explicit finding: OSM Carto does essentially no letter-spacing.** It does *not* do the stretched-label look. Do not use it as a source for tracking values. It is a good source for the *other* line-label numbers, which are all in pixels:

| variable / property | value | file |
|---|---|---|
| `@waterway-text-spacing` | **500** px (distance between repeated labels along a waterway) | `style/water.mss:6` |
| `@waterway-text-repeat-distance` | **200** px | `style/water.mss:5` |
| `text-max-char-angle-delta` (bay/strait) | **15** degrees | `style/water.mss:440` |
| `text-spacing` (bay/strait) | 400 | `style/water.mss:441` |
| `text-spacing` (admin boundaries) | 750 / `text-repeat-distance` 250 | `style/admin.mss:467-468` |
| `text-spacing` (ferry routes) | 1000 | `style/ferry-routes.mss:26` |
| `text-spacing` (aerialways) | 900 / repeat 200 | `style/aerialways.mss:149,152` |
| `@major-highway-text-repeat-distance` / `@minor-...` | 50 / 10 | `style/roads.mss:334-335` |
| `@shield-repeat-distance` | 400 | `style/roads.mss:329` |
| river labels | `text-placement: line`, `text-face-name: @oblique-fonts` (italic), size 10 → 12 at z14, from z13 | `style/water.mss:387-397` |

Compare Mapbox: `symbol-spacing` default **250** px, `textRepeatDistance = symbolMinDistance / 2` = **125** px (`symbol_layout.js`). OSM Carto's 500/200 for rivers is 2× sparser — appropriate for a decorative fantasy map, where you want the river name once or twice, not a chain.

## 5.4 Cartographic convention

Ordnance Survey's *Text on maps* guide (https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/text-on-maps) states the principle but **gives no numbers**:
> For large areas like woodlands or mountain ranges, "the spacing between the letters increased so that the text is spread out across the area to show its lateral extent" — but avoid extending so far that "the word does not get so extended that it becomes impossible to read as a single word."
> For rivers: when text appears within areal linear features like rivers, "the text should be placed within the river but should use **normal letter spacing** so that they are legible."

That last clause is worth noting because it **contradicts the web-map styles**: OS says rivers get *normal* tracking; Mapbox/OpenMapTiles/Protomaps all give waterways **0.2 em**. The reconciliation is that OS is talking about text placed *inside* a wide river polygon at large scale, while the web styles are labeling a thin line at small scale where tracking helps the eye follow the feature. For a fantasy map, follow the web styles.

Recommended values for a procedural fantasy map, calibrated from the table in §5.2:

| feature class | tracking (em) | case | rationale |
|---|---|---|---|
| oceans / seas | **0.30 – 0.50** | uppercase | deliberately above the 0.2 web norm; oceans are the one place hand cartography tracks hard, and there is no competing detail |
| mountain ranges (along ridge) | **0.25 – 0.40** | uppercase | shows lateral extent per OS guidance |
| rivers (along line) | **0.20** | italic, mixed case | matches Protomaps/OSM Bright/Mapbox exactly |
| regions / realms | **0.15 – 0.25** | uppercase | |
| cities / towns | **0.00 – 0.05** | mixed case | Mapbox gives city labels no tracking at all |
| roads / minor labels | **0.00 – 0.10** | mixed case | Basic v9 and Klokantech both use 0.1 |

Above ~0.5 em you cross OS's "impossible to read as a single word" line; that's the empirical ceiling. If you want the extreme Imhof-style spread ocean label, go to 0.5 em rather than 1.0 and lean on size instead.

---

# Verification status

**Verified from primary source (spec text or fetched source file):** the SVG 1.1 and SVG 2 text-on-path layout rules including `mid = x + advance/2 + offset`; SVG 1.1/SVG 2 `startOffset`/`method`/`spacing`/`side` semantics and initial values; Blink's `PositionOnPath`, `PathPositionMapper`, `BuildSvgTransformForTextPath`, and the inline admissions that `side` is unsupported and closed-path handling is skipped; Blink parsing but never consuming `method`/`spacing`; MDN BCD support matrix for `textPath` and `dominant-baseline`; Mapbox `text-max-angle` **45°**, `text-letter-spacing` **0 em**, `symbol-spacing` **250 px**, `text-padding` **2 px**, `text-keep-upright` **true**; `ONE_EM = 24`; angle window `3/5 × glyphSize × boxScale` = **0.6 em**; `checkMaxAngle` and `getAnchors`/`resample` in full; `maxTangent = tan(85°)`; Mapbox's `dx < 0` flip test and `|dy|>|dx|` vertical switch; mid-glyph anchoring in `quads.js`; letter-spacing accumulation in `shaping.js`; opentype.js `forEachGlyph` advance/kern/tracking loop; Mapnik `max-char-angle-delta` **22.5**, `character-spacing` **0.0**, `upright` **auto**, `simplify`/`smooth` **0.0**; Mapnik `simplify_upright` and the upside-down-glyph-count retry; MERL TR96-04 §4.3/§4.5/§5.2 formulas, `inc = width/8`, `k = 32`, `δ = ascent/4 + thickness/2`, swath = 1.2× label width, and Table 1 weights; all letter-spacing values in the §5.2 table; all OSM Carto values in §5.3.

**Could NOT verify:**
1. **Mapbox Streets v8/v11/v12 tracking values.** The production Streets style JSON requires an access token. I substituted the public `mapbox/mapbox-gl-styles` repo (Bright v9, Basic v9), which is Mapbox-authored but is the older v9 generation. Treat "0.2 em for marine, 0.1 em for place_other" as Mapbox-authored but not necessarily current Streets v12.
2. **Wolff/Knipping/van Kreveld/Strijk/Agarwal, "A simple and efficient algorithm for high-quality line labeling."** Confirmed to exist with full bibliographic detail from the author's own publication list, but every PDF mirror returned 404. Its "candidate strip refinement" method is described secondhand only — unverified.
3. **Any numeric parameters for ArcGIS Maplex River placement.** Esri's documentation describes the behavior qualitatively and publishes no defaults.
4. **Numeric letter-spacing recommendations from Ordnance Survey** — the guide is qualitative only; my §5.4 table is a synthesis from the verified style values plus the OS principles, not a cited standard.
5. **The Chromium bug for `startOffset` outside 0–100%** (crbug 476554) is cited *by the SVG 2 spec itself*; I could not open the tracker page directly (requires sign-in), so the bug's current status is unknown — only the spec's assertion that Chrome and Safari fail this case is verified.
6. **The Firefox letter-spacing/textPath defect** is verified as a user-reported reproduction on Mozilla's support forum, not as a filed-and-triaged Bugzilla entry (bug 1668627 returned "Access Denied").

agentId: a65e8fba21826aceb (use SendMessage with to: 'a65e8fba21826aceb', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 185029
tool_uses: 91
duration_ms: 857997</usage>

---

<!-- fuente: labels-dragons-abound.md -->

I have a complete corpus (all 201 posts, ~36 label-relevant ones extracted verbatim). Here is the recipe.

---

# LABELS & TEXT PLACEMENT — Dragons Abound (Scott Turner, *Here Dragons Abound*)

**Method note:** I enumerated the blog's full post list via `https://heredragonsabound.blogspot.com/sitemap.xml` (201 posts, 2016‑10 → 2022‑06; blog ends at "Cleanup Time", 2022‑06‑11), then fetched and text-extracted every post and ranked by label/font keyword density. The label material is essentially all in a contiguous 2017 run plus scattered later style posts.

**Critical caveat up front:** Dragons Abound is **closed source**. Turner narrates the algorithm but **never publishes the energy-function weights, the temperature schedule, the cooling rate, the acceptance probability, font sizes in px, letter-spacing values, or fill hex codes.** Every number he *does* state is captured below verbatim. Where you asked for a number that does not exist in the corpus, I say so explicitly rather than inventing one. The only verbatim JS/SVG code he published in the label/text domain is (a) the quadtree rectangle query, (b) the d3 SVG text-append idiom, (c) the circle/arc polygon generators, and (d) a drag handler — all reproduced below.

---

## 0. THE POST MAP (canonical reading order)

| Post | URL |
|---|---|
| Use the Force (Layout) Luke! | https://heredragonsabound.blogspot.com/2017/04/use-force-layout-luke.html |
| Simulated Annealing | https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html |
| Some Initial Optimizations for Label Placement | https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html |
| Area Labels | https://heredragonsabound.blogspot.com/2017/05/area-labels.html |
| Path Labels (Part One) | https://heredragonsabound.blogspot.com/2017/06/path-labels-part-one.html |
| Path Labels (Part Two) | https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html |
| Path Labels (Part Three) | https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html |
| Path Labels (Part Four) | https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html |
| Path Labels (Part Five) | https://heredragonsabound.blogspot.com/2017/07/path-labels-part-five.html |
| Path Labels (Part Six) | https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html |
| Labels Postscript (Part Seven) | https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html |
| Labeling the Ocean (One / Two) | .../2017/09/labeling-ocean-part-one.html · .../2017/09/labeling-ocean-part-two.html |
| Labeling the Coast (One…Six) | .../2017/09/labeling-coast-part-one.html · .../2017/09/labeling-coast-part-two.html · .../2017/10/labeling-coast-part-three.html · .../2017/10/labeling-coast-part-four.html · .../2017/11/labeling-coast-part-five.html · .../2017/11/labeling-coast-part-six.html |
| Labeling Islands (One…Three) | .../2017/10/labeling-islands-part-one.html · .../2017/10/labeling-islands-part-two.html · .../2017/11/labeling-islands-part-three.html |
| Various Miscellany, Part 2 (web-font bbox bug) | https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html |
| Various Miscellany (Part 2) (capital-city bbox bug) | https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html |
| Recreating a Style (Western Torfani) | https://heredragonsabound.blogspot.com/2017/10/recreating-style.html |
| Recreating a Map Style: Skies of Fire | https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html |
| The Naming of Places (Part 8): The Sea | https://heredragonsabound.blogspot.com/2018/07/the-naming-of-places-part-8-sea.html |
| The Naming of Places (Part 12): Map Interaction | https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html |
| Various Miscellany (Part 3) | https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html |
| Naming Forests | https://heredragonsabound.blogspot.com/2019/01/naming-forests.html |
| Map Borders (Part 15) (text metrics) | https://heredragonsabound.blogspot.com/2019/07/map-borders-part-15.html |
| Knurden Style: Labels & Etc (Part 6) | https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html |
| Map Compasses (Part 8): Radial Text | https://heredragonsabound.blogspot.com/2021/12/map-compasses-part-8-radial-text.html |
| Map Compasses (Part 9): Vertical Text and Radial Arcs | https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html |
| Map Compasses (Part 14) | https://heredragonsabound.blogspot.com/2022/03/map-compasses-part-14-lodestone-loader.html |

Note: "Path Labels (Part Two)" lives under the `/2017/04/` slug despite being published after Part One — a Blogger slug/date artifact, not an error.

---

## 1. LABEL PLACEMENT ALGORITHM

### 1.1 History: force layout → rejected

https://heredragonsabound.blogspot.com/2017/04/use-force-layout-luke.html — two forces initially:

> "Initially, there are two forces in Dragons Abound. The first causes elements that are colliding (on top of each other) to push off against the collision. The second is an attractive force that pulls labels towards their anchors, e.g., that tries to keep the city labels near the city symbols."
>
> "(As it turned out, although d3js has a force layout component, the forces it implements were not very suitable for this problem, so I had to code up a couple of new force implementations.)"

Coastline/river/border obstacles were added as per-segment boxes. Failure mode:

> "It's pretty easy for labels to get 'trapped' in a poor location with forces pressing in from all sides, when there's a much better location just on the other side of one of the forces. In computing terms, this is known as getting stuck in a local minima."

### 1.2 Optimizer: simulated annealing

https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html

> "d3js doesn't have a simulated annealing component built in (as it does with force layout) but Evan Wang from UCB has written a simulated annealing plug-in for d3js. To be honest, the plug-in isn't very good. It doesn't handle a lot of the cases that Dragons Abound requires, and in places the code is either wrong, doesn't work, or doesn't fit with my existing code. So I have to rewrite most of it."

**Temperature semantics** (this is the only definition of "temperature" given — it is a *move-radius* schedule, not a Metropolis-acceptance schedule):

> "This temperature corresponds to how far away from the current point we can look for a better solution. So when the temperature is high, the next point we look at can jump over nearby peaks to land on the far side, even if it where it lands is worse than where it started. As the annealing process continues, this temperature is slowly lowered, so that the search settles into the best solution."

**No cooling formula, no `exp(-ΔE/T)` acceptance expression, and no initial/final temperature are ever published anywhere in the blog.** He only states qualitatively that a worse move can be accepted:

> "In simulated annealing, every time a change is contemplated there's a chance it will be accepted, even if the change makes the overall score worse." (https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html)

**Timings:**
> "The total run time for the above map with force layout was 335 seconds; with simulated annealing it was 185 seconds." (simulated-annealing.html)

### 1.3 Energy function — POINT labels (cities)

https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html — verbatim, "in rough order of importance":

```
Going outside the map area.
Distance of the label from its anchor point.
Overlap between labels.
Overlap between labels and map features.
Label placement penalty.
```

The 5th term, verbatim:

> "For labels like city labels, where the label provides the name for a feature at a point on the map, Imhof defined the best locations (with respect to the anchor point) as being (in order): to the upper right, to the lower right, to the upper left and lastly the lower left. So the last element of the energy function tries to get labels into the best relative position to the anchor point."

⇒ **4 discrete preference quadrants, ranked UR > LR > UL > LL.** The relative penalty magnitudes are not published. Empirically confirmed in the same post: *"all the labels in this map ended up in the prime label position to the upper right of the their anchor points."*

### 1.4 Energy function — AREA labels (regions, oceans, bays, forests, islands)

https://heredragonsabound.blogspot.com/2017/05/area-labels.html — the point-label list is replaced by:

```
Going outside the map area.
Distance of the label from its anchor point.
Going outside the label area.
Overlap between labels.
Overlap between labels and map features.
Label placement penalty.
```

The "outside the label area" test is deliberately cheap:

> "Ideally, I don't want any part of an area label to go outside of the area, but that's fairly hard to compute (especially if the label is curved). But as a simple approximation, I can try penalizing an area label if the center of the label is outside of the area."

and the reason a center-only test suffices:

> "This simple approach works pretty well for regional labels because it turns out that if the center of a label is in the areas, but some other part of the label goes outside the area, the label incurs a different penalty for crossing a coast or a border. This seems to be enough to keep labels from being half-in and half-out on most maps."

Restated for oceans at https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html:

```
To stay within the area
To stay away from the edges of the area
To avoid overlap with another label
To avoid overlap with a feature
To stay on the screen.
```

**Degenerate-plateau fix (important, non-obvious):**
> "there are many positions for the ocean label that are all equally good. Basically any spot in the ocean that doesn't overlap another label or the land gets the same score. So there's a good chance over many iterations that the label will bounce off to one of these other locations, essentially randomly. The solution is to add a very small attraction to the label's starting point."

**Forest/region axis heuristic** (https://heredragonsabound.blogspot.com/2019/01/naming-forests.html):
> "I've added a placement criteria that tries to maximize the closest distance between the label and the polygon defining the label area. Although this isn't foolproof, in many cases it will effectively force the label to lie along the major axis of the region."

### 1.5 Energy function — PATH labels (rivers, coastlines, borders, peninsulas)

https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html — #2 and #5 of the point list are dropped, two new criteria added:

```
Going outside the map area.
Overlap between labels.
Overlap between labels and map features.
Offset distance.
Curviness of path.
```

**Offset distance is a target, not a minimum:**
> "Initially I thought that trying to minimize the offset distance was the right idea, but it turns out that jams all the labels right up against the river. It's better to reward a label that's close but not too close -- say a half label height or so away from the river."

**Curviness metric = sinuosity:**
> "How do you measure curviness? I chose to use a simple metric: the ratio of the length of the path between the two red dots to the straight-line distance between the two red dots. That turns out to be sinuosity."

**Later refinements** (https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html): offset test sampled at 3 points —
> "I also have to tweak the criteria for path labels to make the criteria that tries to snug the label up to the river a little smarter: It now checks both corners and the midpoint of the label."

and a *curvature* criterion separate from path sinuosity:
> "Another way to keep labels from being too curved is to create a new criteria that prefers labels with small levels of curvature. This has the advantage that a sharper curve can be used when it enables the label to avoid a bigger problem, e.g., to avoid obscuring another label."

**Midpoint-of-path criterion** (https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html), credited to /u/Azgaar:
> "I just calculate the center of the label, measure the distance from there to the midpoint of the river (path) and apply that (with some weighting) as a penalty to the label placement. … I have to be careful with the weighting here, because I'd rather be on a straight part of the river that's further from the center than on a sinuous part of the river right near the center."

**Coast labels are anchored, river labels are not:**
> "Unlike river labels, which can be placed anywhere along the river, the coastline labels try to stay near a particular spot on the coastline." (coast part two)

**Side constraint:** each path label carries a sign flag on its offset —
> "River labels can be on either side of the river, but some kinds of path labels need to be on one side of the path or the other (border labels being an example). So when I create a path label to place, I need to note whether the offset can be positive or negative or both." (path labels part one)
> "The routine that constructs coastlines is supposed to consistently put the ocean to the left side of the line, so in theory the labels should have negative offsets to be on the ocean side of the coastline." (coast part two)

**Overlap penalty is area-weighted** (https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html):
> "The probable cause is treating all overlaps as equal. A major overlap of a region label with a city label is just as bad as an overlap of a region label with a tiny bit of coastline. To improve this, I can calculate the area of overlap and weight the penalty accordingly, so that the simulated annealing tries hard to avoid major overlaps and will trade a couple of minor overlaps for a major overlap."

**Island de-clutter criteria** (https://heredragonsabound.blogspot.com/2017/11/labeling-islands-part-three.html): an inter-label repulsion term and an angle-flattening term, both tunable:
> "One thing I can tweak is to encourage the labels to stay away from each other and the other islands." / "I can tweak the map to try harder to make all the island labels horizontal."

### 1.6 Candidate move generation

**Point labels** (https://heredragonsabound.blogspot.com/2017/05/area-labels.html):
> "For point labels, new candidate locations are generated by displacing the current location, or rotating the current location around the anchor point."

**Area labels — temperature-switched two-mode generator** (same post; this is the single most implementable move-generation detail in the whole series):
> "I set up area labels so that when the temperature is high, it tries random locations within the area. As the temperature gets lower, it switches over to small displacements. The idea here is to try a bunch of random locations within the area while the temperature is high and settle on the best candidate, and then to tweak that candidate around in small ways to look for minor improvements as the temperature cools off."

Uniform-random-point-in-polygon by rejection sampling (he explicitly rejects triangulation):
> "The most rigorously correct solution is to divide the area (polygon) up into triangles, and then select a random triangle (based upon the area of the triangles) and then find a random point in the triangle (a known solution exists for this problem). That sounds like a lot of work. The less elegant solution is to find the bounding box for the polygon, generate a random location within the bounding box, and then test to see if that's also within the polygon. … However, this version is at least very easy to program."

Addendum, same post — seeding:
> "(Addendum: /u/redblobgames recently pointed me towards a small Javascript library from MapBox for finding the visual center of a polygon. This is intended to be a good position for an area label, so I modified Dragons Abound to use this as the starting point for area labels. In many cases this doesn't make much difference -- simulated annealing tends to settle on the same-ish solution regardless of the starting point -- but for some regions it's helpful to start in a good position.)"

⇒ **seed = mapbox/polylabel visual center.** For oceans he replaces this with a max-clearance point (§3.4).

**Path labels — 3 free parameters** (https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html):
> "to generate a new candidate label I only have to randomly come up with a position along the path, an offset from the path, and an amount of arc. Then I just let the algorithm try lots of these combinations to find one that works well. (To be fair, it's not quite that simple. For simulated annealing, I need a method for finding candidate arcs that keeps them closer and closer to the current arc as the algorithm anneals. That's a matter of making the new candidates randomly based on the current candidate rather than completely random.)"

Position-along-path uses SVG path arithmetic, not segment math (https://heredragonsabound.blogspot.com/2017/06/path-labels-part-one.html):
> "Since I've drawn the path, I can make use of some of the browser-provided methods for dealing with SVG paths. It turns out that the browser provides a method for measuring down the length of a path and finding the screen point at that location. So I can generate a candidate point by generating a random number between 0 and the length of the path and then using the SVG method to find the point at that distance."

(i.e. `path.getTotalLength()` + `path.getPointAtLength(t)`; he doesn't name them, but that is the only API matching the description.)

Annealing window on position, and on offset:
> "I accommodate this by picking points in a window around the current position, rather than randomly along the whole length of the river. As the temperature drops, I make the window smaller and smaller."
> "So I make the new offset be based upon the current offset, and as the temperature drops this is made to be closer and closer to the current offset."

**Angle as a search variable** (https://heredragonsabound.blogspot.com/2018/07/the-naming-of-places-part-8-sea.html) — **the one hard angular number in the corpus**:
> "The basic implementation is to provide a range of allowed angles for each label, and let the label placing routine vary the angle along with the position as it is trying to find a good spot for the label. (None of the evaluation code needs to change, because the criteria for a good placement hasn't changed.) **Generally speaking I will limit straight labels of this sort to the angle range of -45 degrees to 45 degrees.** Anything outside that range becomes hard to read, looks awkward, or is upside down on the map."

**Max move cap** (https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html):
> "the distance a label can move in each iteration of the simulated annealing is based on its size. Really large labels … could move quite a ways when the simulated annealing temperature was hot -- too far to get back as the temperature cooled down. The solution to this was just to cap the maximum move for any label to a value that couldn't take it so far off the screen that it couldn't recover."

**Label padding** (same post):
> "I solved this by adding a little padding to the end of the labels, so that even if two labels end up in this position, they'll have a visual break between them."

### 1.7 Two optimizer improvements — each **~20%**

https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html

**(a) Return best-ever, not final:**
> "The solution to this is to save the best solution found and return that when the algorithm ends. … It's fairly powerful, too. On my test maps, **the best solution is about 20% better than the ending solution (!)**."

**(b) Rejected variant — do NOT restart from best on temperature change:**
> "An extension of this idea is to send the algorithm back to the best solution every time the 'temperature' of the simulated annealing changes. … However, in testing this doesn't improve the results. In most cases, it makes them worse! I suspect the reason is that this tends to increase the chance the algorithm will get caught in a local minima."

**(c) Score-weighted label selection** (replaces round-robin sweeps):
> "The initial implementation makes a full pass through all the labels at every iteration. … My solution was to weight the chance of selecting a label for a change by its score. So a label with a high score has a high chance to be selected for a change, while a label with a low score has a low chance of being selected. As labels are improved, their chances for further changes go down, so the algorithm keeps shifting its attention to the current worst labels."
> "For my test maps, this is also a very effective improvement with (again) **about a 20% improvement over the previous best solutions.**"

### 1.8 Iteration counts — the measured convergence curve

https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html — direct experiment, all labels, initial state = city labels dropped on top of city symbols, region labels at initial guess:

- **100 iterations**: *"Even this small amount of effort produces 'pretty good' results."* Two defects (one label off map edge, one region label on a border).
- **1000**: *"Most of the city labels are now optimal."*
- **2000**: *"the algorithm has traded off the various problems in the previous map for only one problem."*
- **4000**: *"the algorithm has found a fairly optimal solution."*
- **8000**: *"This time the algorithm has settled on the same (sub-optimal) solution it found after 2000 iterations."* — regression, by design.

Conclusion, verbatim:
> "This makes it pretty clear that most of the improvement happens pretty quickly. For most purposes, **a fairly small number of iterations (~1000) produces an acceptable result with very little time spent.**"

Separately, the ceiling after the quadtree optimization (https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html):
> "it turns out that there isn't much improvement beyond about **2500 iterations per label** -- at least with the algorithm as it works right now."

**Implementable defaults:** ~1000 global iterations for production; 2500/label is the point of diminishing returns; always return best-ever.

---

## 2. COLLISION AVOIDANCE

### 2.1 Feature discretization — everything becomes a rectangle

https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html:
> "It's fairly easy to figure out when two axis-aligned rectangles are overlapping. It's much harder to tell when two arbitrary polygons are overlapping. So to make things easy, Dragons Abound treats all the map features that have to be avoided as rectangles (this will soon change :-). That's why cities in the previous map have green rectangles instead of green circles. (Actually, circular overlap is pretty easy to compute also, but it simplifies the code to treat everything as a rectangle.)"
> "The coast is a long wiggly line. It is turned into rectangles by breaking it up into line segments and drawing a bounding box around each segment."

Same treatment for rivers and borders. Fencepost bug worth pre-empting (https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html):
> "it turns out the bounding box for the very end of the river was missing … And indeed, to turn a path into a sequence of bounding boxes I operate two elements at a time."

Lakes: **whole lake**, not just the shore (https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html):
> "The edges of the lake are boxed but the lake itself is not. … So it would be better to make the whole lake something to avoid. I can do that by using the bounding box of the lake as the feature to avoid."

Mountains and forests are **not** obstacles by default (https://heredragonsabound.blogspot.com/2017/07/path-labels-part-five.html):
> "But mountains are big features, and on many maps, that would make label placement very difficult. … It's inevitable that labels are going to at least occasionally overlap map features, so I need a way to make labels more readable when they do." (→ masking, §5)

### 2.2 Text extent measurement in SVG — three coordinate systems

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html — **the single most load-bearing implementation detail:**

> "There are three different coordinate systems I need to track:
> The black circle represents the coordinates of where I drew the text on the screen. With left-justified text, this is the left-most point on the text baseline. The green circle represents the origin of the bounding box around the text. This is below the black circle because (1) the text has a descender that goes below the baseline, and (2) SVG seems to add some margin on the top and the bottom of text (but not on the left and right?). Finally, the red circle represents the center point of the bounding box. I use this as the location of the label."

> "**The only way to figure out the origin (green circle) and size of the bounding box is to draw the text on the screen and use the browser to measure the text.** So when I first place a label on the screen I have to measure the bounding box in order to calculate the relationship between the black, green and red circles. **Fortunately this works the same for both regular text and text which has been placed on a path** (which is how I created the arced region labels)."

⇒ **`getBBox()` on the rendered element.** He names `getBBox()` explicitly in the sibling refactoring post https://heredragonsabound.blogspot.com/2017/04/towards-idiomatic-javsascript.html:

```javascript
let rect = world.mountains[i].node().getBBox();
```
```javascript
function toBB(mtn) { return mtn.node().getBBox();}
```

`getComputedTextLength()` is **never mentioned anywhere in the blog.**

Bbox padding caveat (https://heredragonsabound.blogspot.com/2019/07/map-borders-part-15.html):
> "It's very hard to tell how big a piece of text is in SVG. You can certainly get a bounding box for the text, but that turns out to include space for descenders (i.e., the bottom part of a lower-case g, for example) and some space at the top of the text, whether your actual text is using that space or not. So doing something like centering text in a box is much more difficult than you might expect, because there will be unexpected extra space above and below the characters. Even worse, if the font doesn't have the proper metadata (and many free fonts you'll find don't) then this measurement is even worse. Long story short, before I can use a font in the program I have to play with it to see how well it actually works."

### 2.3 THE WEB-FONT MEASUREMENT TRAP (must-implement)

https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html — verbatim:

> "For some time I've had an odd problem with putting labels on the map. They would overlap other labels or land features when they weren't supposed to be overlapping. After some digging, it turned out that the browser was calculating the bounding boxes for the labels incorrectly … After some experimentation, I figured out that this was only happening when I used Web fonts. These are loaded into CSS and then applied to the text on the map. The problem is that browsers are generally (1) lazy and (2) asynchronous. Chrome doesn't load a Web font when it is defined in CSS, but waits until it is actually used in the web page. … So in this case, the font loading doesn't start until the labels on the map are being displayed -- which is long after I've randomly selected a font for the map and tried to measure the labels. So how does Chrome measure the labels before the font is loaded? When the styled font is unavailable, the browser fails back to a default system font. So the bounding boxes shown up above are based upon displaying the label in a system font (Helvetica in this case)."

The fix, verbatim:
> "The solution is to force the browser to load up all the possible fonts before I try to generate the map. … So when the browser first loads the page that generates the map, I iterate through all the possible fonts, add them to the CSS for the page, and then put an element on the page that uses the font. **It turns out that the element using the font has to be visible (that is, you can't use "display:none") but it doesn't actually have to contain any text. So it is sufficient to stick an empty `<span>` element into the page for every possible font.** After that, the bounding boxes are calculated correctly."

Related bug class (https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html):
> "there was a bug in the code that was causing the bounding box for capital cities to be computed with the font size of a smaller city, while the label itself was getting the correct size."

Font format used (https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html):
> "Dragons Abound uses both web fonts and locally stored fonts, **all in WOFF2 format**. In the browser, these are applied to text by using a CSS 'font-family' style, and before the map is generated, all the possible fonts are loaded into the Web page to be ready to use."

### 2.4 Rotated / oriented bounding boxes for path labels

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-one.html:
> "I put bounding box in quotes there because bounding boxes are typically aligned with the coordinate system, and in this case I actually want the bounding box aligned with the angle of the label. To create this angled bounding box, **I measure the regular bounding box when the label is horizontal, and then I rotate this through the same angle as the label.**"

The angle comes from the chord, not the tangent:
> "I calculate the normal to the line between the start and end points. This is another reason to find the end point -- it lets me approximate the normal to the path over the length of the label."

End-point search (label length `l` along the path):
> "The closest this point can be (if the path in-between is a straight line) is an additional distance 'l' down the path. If the path is not perfectly straight, then it's actually further along the path. In that case, I step along the path in small increments until I hit the first point that is 'l' or further away from the start point."

### 2.5 Curved (polygonal) bounding "box" for path labels — the offset-ribbon construction

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html — verbatim recipe:

> "First, it's obvious that we can't actually use a box -- we need a shape that is close to the curve to which the final text will be fit, so that it will bend around obstacles appropriately. …
> It seems like I could start by duplicating the path between the two points and offset it to where I want to place the text.
> Assuming I want the new path to be X units away from the existing path, how should I offset it? The right answer is probably complex, but reasonable approach might be to **establish a normal to the line between the two endpoints on the original path and offset the new path in that direction X units.** …
> Next, **I create another copy of the path and offset it in the same direction the maximum height of the text.** …
> Finally, **I connect the endpoints of the two copied paths.**
> And that is the bounding box for text placed along the river at that location with X offset. (With some allowances for descenders in the text and so on.)"

Known residual error:
> "This isn't exactly right, because SVG seems to place each glyph (letter) in the text at the normal to the path at the point where the letter is drawn, but it will at any rate be a much better approximation than the rectangular bounding box."

Why the rectangular version was insufficient (the convex-side failure):
> "because the river is convex between the two anchor spots for the bounding box, the bounding box will inevitably overlap the river, unless the offset from the river is very large … And that placement will get a largely penalty for being so far away from the river. This means that labels are rarely placed on the convex side of a river."

Center of the curved bbox:
> "The center of a curved arbitrary bounding box is probably a problematic notion, but at any rate the spot I want to use is **halfway between the middle points of the top and bottom sides of the bounding box.**"

### 2.6 Polygon–polygon and polygon–box intersection

https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html:
> "I ended up using an implementation of Greiner-Horman from Alexander Milevski. I chose this implementation because it was fast, small and did what I needed, but he also has a more full-feature implementation of Martinez-Rueda polygon clipping that I can switch to if necessary."

Then the optimization pass, https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html:
> "In the end I settled on using a library based upon the Greiner-Horman algorithm. This library was small, self-contained and fairly speedy. I used this for all path label comparisons, and for comparing path labels to features. (For the other types of labels I can still use the fast bounding-box overlap.) But it still added a lot of computation. **Run time for a map was 140 to 200 seconds.** Ouch."

> "It occurred to me eventually that there was probably a faster algorithm for the special case of clipping a polygon to a bounding box. It turns out there are several, depending upon how complex the polygons are, but a good one for my case is the **Sutherland-Hodgman** algorithm. The good folks at Mapbox have done a Javascript implementation."

> "Switching to the Sutherland-Hodgman for the path label to feature collision checks cut the run-time dramatically. **A typical map went from 149 seconds to 59 seconds. The collision checks are only about 4% of that run-time after the switch.**"

Two library bugs he hit, both worth guarding:
> "The code gets confused if the polygon repeats its start point at the end. I was doing this for ease of drawing, but I was able to remove the duplicate end point, and that addressed many of the disagreements."
> "if the polygon is just touching the bounding box at one of the corners, the code identifies that as an overlap and (incorrectly) returns one entire side of the bounding box as the intersection. … **In some ways this is a fortuitous bug: reporting this as an intersection just means that Dragons Abound will avoid placing labels that touch each other, which is good behavior for my purposes anyway!**"

Also: at one point he was **only checking the diagonal** of the label polygon —
> "I had a silly error in how I was constructing the polygons for that check, so I was essentially only checking the diagonal rather than the whole polygon." (path labels part two)

And: **new label classes must be added to every other class's collision list** —
> "The most relevant is that I hadn't gone back to the code for the area and point labels and updated them to check for overlaps with the path labels."

### 2.7 Quadtree spatial index — VERBATIM CODE

https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html

> "One of the slowest parts of the algorithm is checking to see if a label intersects with a map feature. Finding the intersections between labels is not a big problem because there are only a few labels. But there are many map features (**1712 in the map above**) so checking a label against all the map features is a big effort."

> "First, the d3 implementation doesn't provide a function for finding all the points near a point. That would have been handy, but with a little thought it's possible to figure out how to implement a function to retrieve objects near a point using `d3.quadtree.visit`. Since the labels are rectangular, I can search for objects within that rectangle."

```javascript
    // Find all points in quadtree that are (possibly) within a rectangle
    function qtWithinRect(quadtree, rect) {
        var results = [];
        quadtree.visit(function(node, x0, y0, x1, y1) {
            // Does this node overlap with our rectangle?
            let x_overlap = Math.max(0, Math.min(rect[1][0],x1) - Math.max(rect[0][0],x0));
            let y_overlap = Math.max(0, Math.min(rect[1][1],y1) - Math.max(rect[0][1],y0));
            let overlaps = (x_overlap > 0) && (y_overlap > 0);
            // If this is a leaf, add it's nodes to results
            if (!node.length) {
               do {
                  results.push(node.data);
               } while (node = node.next);
            }
            return !overlaps;
        });
        return results;
    };
```

Two caveats, verbatim:
> "Note that this doesn't guarantee that all the points returned are within the rectangle, because it returns all the points in nodes that overlap with the rectangle. That overlap isn't necessarily complete, so there may be some points in the node that lie outside the overlap. I could check to make sure the points are within the rectangle before adding them to the results, but it turns out in my case … including some nearby points is actually fine."

> "The second problem is that this doesn't quite work for finding labels that overlap features. **I'm indexing features in the quadtree by the center of the feature.** This function will find features whose centers lie within the label, but it won't necessarily find features whose centers lie outside the label, but still overlap the label. … Completely fixing this is complicated, but on a practical level it works fine to **keep track of the size of the features as you add them to the tree and then pad the search by the dimensions of the biggest feature.** This padding can pick up features that don't overlap the label, which makes the algorithm a little less efficient, but it's not a big impact."

Payoff:
> "It saves **about 90%** of the time spent in calculating label scores (!)."

Second quadtree use (https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html):
> "I use the D3 implementation of quadtree, so `findLocAt()` just becomes `quadtree.find()`. With this substitution, findLocAt() goes from taking up about 6% of the processing time to almost unmeasurable -- **4672 ms to 2.7 ms** on my sample map."

---

## 3. CURVED TEXT ALONG PATHS

### 3.1 The core statement: region/area labels ride an ELLIPTICAL ARC

https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html — verbatim, and this is the definitive sentence in the whole corpus:

> "I don't think I've written about how the curved labels are implemented, but it isn't difficult. **SVG provides a capability to place text along a path. The curved labels in Dragons Abound are placed on an elliptical path. The hardest part is figuring out the appropriate size of the ellipse!**"

So: **not** a circle fit through the region, **not** a spline — an SVG `A` (elliptical arc) command whose rx/ry are chosen per label, with `<textPath>` on it. The arc is a *generated* baseline, decoupled from any underlying feature geometry.

### 3.2 `<textPath>` and `startOffset`

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html:
> "Laying out text along a path in SVG is actually straightforward; you create a piece of text as usual, and then you attach it to a path via a TextPath element."
> "(Blogger seems to have some problems with embedded SVG, so I used an image instead.)"
> "**You can control where the text falls along the path using the "startOffset" parameter**, which works pretty much exactly how you'd imagine. So it's pretty simple to drop text on a path."

**Centering value + the SVG quirk** (https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-two.html):
> "**I'm centering the label on the arc by setting the label's anchor to the middle of the label, and then placing the label at 50% of the way along the arc.** This should be correct, but something about the combination seems to be broken. I can apply a manual adjustment … This adjustment changes a little bit with the length of the label, so this won't be as accurate for a different length label, but this isn't brain surgery, so I picked a reasonable value and left it at that."

⇒ `text-anchor="middle"` + `startOffset="50%"`, plus an empirical fudge that scales with label length. **The fudge value is not published.**

Also from the same post — a Y-offset bug worth knowing:
> "The error on my part is in miscalculating the Y offset for the label; I accidentally had it at twice the necessary value."

### 3.3 Direction reversal — you need TWO paths, not a rotation

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html — verbatim:
> "When my path labels were just regular text, I could flip them around to the other orientation by rotating the text 180 degrees and then moving it to the other end of the bounding box … Unfortunately, that won't work for path labels. **When you lay out text on a path, the direction of the text matches the direction of the path. If you want the text to run the other direction, you need a path that runs in the other direction.**"
> "(In either case, you can move the text to the other side of the path by using an offset but that doesn't chance the direction or orientation of the text.)"
> "It's possible to reverse an SVG path, but **the easier solution in this case is just to create paths in both directions for the river so that I can switch labels from one to the other as necessary.** However, the starting point isn't the same; when I reverse the path I have swap the starting point to the other end of the bounding polygon. I also have to adjust the offset to pull the label back onto the same side as the bounding polygon."

For arc labels the equivalent is arc reversal (https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html):
> "the one obvious problem is that reversed labels (like the middle 'Lost Coast') aren't in their bounding boxes. That's just a matter of reversing the direction of the arc when the label direction is reversed."

Also flip the bbox *contents*, not the bbox (path labels part two):
> "The problem is that I also flipped the bounding box when I flipped the label. … **What I want to do is flip the label within the bounding box.**"

### 3.4 Ocean labels — arc orientation rules

https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html and .../part-two.html:

**Anchor point = max-clearance interior point (not centroid, not visual center):**
> "What I really want is something like **'the interior point of the polygon with the greatest minimum distance to an edge.'**"
> "For a point inside a simple polygon, it's not too hard to find out how far the point is from the polygon. You iterate through all the edges of the polygon, calculate the distance to each line segment, and then take the minimum of those values. It gets more difficult when you have a complex polygon with 'holes' in it."

**Baseline angle — v1: major axis:**
> "My simple approach to this will be to find the two points in the ocean that are the farthest apart and call the line between them the major axis of the ocean."

**Baseline angle — v2 (superseded v1):**
> "After some thought, I decided that it might look better for the label to rotate around the center of the map. This would mean **the base angle would be at right angles to the line from the label to the center of the map.** … That looks much better to my eye."

**Arc sweep rule:**
> "the curve of the arc should be going away from the center of the map. It turns out that **when labels are on the lower half of the map, I also have to reverse the 'sweep' of the elliptical arc so that it bends the other way.**"

**Rotating the arc itself:**
> "the first step is to rotate the start and end points of the arc around the center point by the angle of the major axis. But then I also have to rotate the ellipse itself. **Fortunately, that's built into the SVG routine for making elliptical arcs, so I just have to feed in the same angle of rotation to the arc routine.**" (= the `x-axis-rotation` parameter of the SVG `A` command)

**Push toward map edge — the one concrete percentage:**
> "I'll shift the starting point of the label out along the line from center of the map to the original placement. (Since the center of the map is (0, 0), this vector is easy to calculate from the original starting position.) Then I can move the label outward along that vector some percentage of the radius of the green circle -- **say 50% to place the label halfway between the center of the green circle and the edge of the green circle.**"

**Bounding box for a rotated arc label** — use the rotated straight-text box, not the arc's box:
> "because the label is rotated onto a diagonal, the bounding box for the label is much bigger than the label. … Since the curve of this label is pretty shallow, **I'm going to use the rotated bounding box for the straight text as a better approximation.**"

**Ocean-label trigger thresholds:**
> "Contiguous water that covers more than (say) **25%** of the map will get a label." (part one)
> "…choosing to label any ocean bigger than **20%** of the map isn't a good enough heuristic. A quick solution to this is to put some minimum on the 'distance to land' metric … In fact, maybe **that metric alone is sufficient** for determining when to create an ocean label -- I can drop the 20% ocean minimum, and just label oceans when I find a big enough expanse of open sea." (part two)
> Corner bonus: "I can get this behavior by **adding a bonus to spots that touch two map edges at the same time.**"

### 3.5 Path smoothing when text DOES follow a real path (river labels)

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html — two smoothers, one dominant:
> "I have two ways to smooth out a path. One method works by dropping some of the points in the path, and the other works by average each point with it's neighbors. Both of these help, but **dropping points is the most important factor.**"
> "I'm going to look at one called **Visvalingam's algorithm**, primarily because Mike Bostock uses it on this page … The algorithm simplifies the line by repeatedly removing the middle point of the smallest triangles."
> "Here's a map that compares the original rivers to rivers with **50%** of the points removed: You can see some differences in the paths, but it's pretty minimal. **To get to a path that's more suitable for drawing labels, I have to remove about 85% of the points.**"

⇒ **Visvalingam at ~85% point removal, then neighbor-averaging.**

### 3.6 Turner's own verdict: real-path-following text is a dead end

https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-one.html:
> "even on this path with much lower sinuosity the letters in the name end up clashing with each other. … To be honest, **this is partly SVG's responsibility: It just doesn't do a very good job laying out text along a path.** But even when the letters don't clash, I find don't really like the look of text on an arbitrary path."

https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html — **the architectural pivot; implement this, not §3.5:**
> "The current algorithm works as shown in this image: The original path is shown here as the blue line. From that path, I create a relaxed version with the same endpoints (the gray line). Then I offset the gray line from the original path (the dashed gray line) and lay out the text along the offset path."
> "After looking over a lot of maps, I think what looks best is **a label along a gentle, symmetrical arc.** … **So I'm going to abandon using the original path completely, and just try to find a suitable arc.** I already know how to generate text on an arc (that's how the region labels are displayed), so the challenge here is to place labels and figure out an arc that looks good along the path."
> "I'll be honest and admit that I spent a lot of time going down a dead-end path (ha!) involving trying to determine whether the section of path next to a label was generally convex or concave and creating the label accordingly. Despite quite a bit of effort, I never got that code completely working. On the third or fourth attempt, I had a (mild) epiphany: **I didn't really need to put so much effort into trying to create a well-fitting label. That's what I have the simulated annealing algorithm for.**"

Also, over-curvature labels get **dropped**, not fixed (https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html):
> "For now, I'm going to take an easier way out: **I'll simply drop any labels that are too curvy.** Since rivers are often unlabeled anyway, this should look fine."

### 3.7 River-label eligibility

https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html:
> "For Dragons Abound I'm choosing to label only the rivers that are substantially longer than the river name. 'Substantially' is a matter of taste, but **in practice a number in the range 1.25x to 1.75x seems to give the right proportion to my eye.**"

Multi-labeling long rivers is implemented but disabled:
> "adding multiple labels isn't terribly difficult -- I just put two labels on the river, and because the simulated annealing algorithm tries to avoid overlapping labels, they get pushed apart … **at the moment I'm using a single label.**"

### 3.8 Sinuosity constants (used for both label placement and bay detection)

https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-one.html:
> "The distance between the end points of a semi-circle is the diameter D of the circle. The distance along the semi-circle is half the circumference of the circle, (Pi*D)/2. So the sinuosity of a semi-circle is **Pi/2, or about 1.5**. Therefore a coastline with a sinuosity close to 1.5 is shaped something like a bay (semi-circle), while a sinuosity close to 1 is more like a straight stretch."

Bay detection later upgraded (https://heredragonsabound.blogspot.com/2017/11/labeling-coast-part-five.html):
> "I need to use **a combination of the area, the length of the bay shoreline, and sinuosity** to identify 'bay shaped' areas."
> Brute-force length search: "I'll implement a straightforward brute force search and **keep the candidate with the highest sinuosity**."

Point detection (https://heredragonsabound.blogspot.com/2017/11/labeling-coast-part-six.html):
> "I'll require that **a point not take up more than (say) 1/4 of its coastline** … This point has a **ratio of length to width of about 3.**"

### 3.9 Verbatim arc-generation code (from the Compass series — the only published arc code)

https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html

```javascript
// Make a circular polygon
function makeCircle(center, radius, num) {
    const result = [];
    const step = (2*Math.PI)/num;
    for(let t=0;t<(2*Math.PI);t += step) {
	result.push([radius*Math.cos(t)+center[0],radius*Math.sin(t)+center[1]]);
    };
    // Close off the circle
    result.push(result[0]);
    return result;
};
```

```javascript
// Make a circular arc
function makeCircularArc(center, radius, start, end, num) {
    const [x, y] = center;
    const result = [];
    const step = (end-start)/num;
    for(let t=start;t<end;t += step) {
	result.push([radius*Math.cos(t)+x,radius*Math.sin(t)+y]);
    };
    result.push([radius*Math.cos(end)+x,radius*Math.sin(end)+y]);
    return result;
};
```

```javascript
function rarc(svg, center, radius, startAngle, repeats, angle, iteration, op) {
    const arcStart = angle-0.5*op.subtend;
    const arcEnd = angle+0.5*op.subtend;
    const outsideEdge = makeCircularArc(center, radius, arcStart, arcEnd, 20);
    const insideEdge = makeCircularArc(center, radius-op.width, arcStart, arcEnd, 20);
    const polygon = outsideEdge.concat(insideEdge.reverse());
    svg.append('path')
	.style('stroke-width', 0)
	.style('stroke', 'none')
	.style('fill', op.color)
	.attr('d', lineFunc(polygon));
};
```

> "This is using **20 points** on the edges; that seems to be good enough to give a smooth curve at these sizes."

Rationale for hand-rolling instead of using SVG `A` / d3.arc — directly relevant if you want hand-drawn-looking label baselines:
> "SVG has a path command for drawing an elliptical arc; it's notoriously difficult. As is often the case, D3 provides a much simpler way to draw a circular arc. However, I'm going to choose not to use an SVG command and instead draw the arc directly. … while SVG will draw a perfect arc, when I use this code in DA I'll want to be able to draw a (subtly) imperfect arc to make it look hand-drawn. To do that, I need to do the drawing myself."

---

## 4. FONTS & TYPOGRAPHY

### 4.1 Font families — every one named in the corpus

| Font | Use | Source |
|---|---|---|
| **IM Fell** (family) | default "old book" atmosphere for all labels | https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html |
| **IM Fell DW Pica** | Western Torfani recreation; italic → city labels, small caps → map feature labels | https://heredragonsabound.blogspot.com/2017/10/recreating-style.html |
| **IM Fell DW Pica** + italic variant | Knurden style: roman → cities, italic → woods, roman all-caps → regions | https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html |
| **IM French Canon** | Skies of Fire recreation | https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html |
| **IM Fell English** | compass label option | https://heredragonsabound.blogspot.com/2022/03/map-compasses-part-14-lodestone-loader.html |
| **Aniron** (Pete Klassen) | LotR style — **rejected**, "doesn't seem to be able to accurately measure the size of the font" | https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html |
| **Kelt** | LotR style fallback — sizes correctly but hits a "3 year old bug in Chrome" (letters not filled); renders correctly in Firefox | same |
| handwriting fonts | D&D / "Dungeon Master" style only | labels-postscript-part-seven.html, https://heredragonsabound.blogspot.com/2020/11/d-style.html |
| typewriter fonts | map captions in D&D style | d-style.html |
| **Serif**, **Lobster**, **Helvetica** | compass labels / stress tests | map-compasses part 8 & 14 |

Verbatim (recreating-style.html):
> "The Western Torfani map is using one of the IM Fell fonts ('IM Fell DW Pica') for labeling, using the italics version for the city labels and the small caps version for the map feature labels. I can sort-of recreate some of this; I already have the IM Fell fonts as an option, and the code has an untested capability to style different types of labels differently (i.e., make the city labels italic) but doesn't have the ability to use different fonts for different labels. **However, you can fake small caps using the SVG/CSS 'font-variant' property.** This isn't quite as good as using a specifically designed small caps font, but it will work."

### 4.2 Per-feature-class styling — the Knurden spec (most complete style breakdown published)

https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html — verbatim:

- **City/town labels:** "The font used for the labels is one of the IM Fell fonts (DW pica). **The city labels are filled in a light reddish brown, and stroked in a dark red brown.** … The Knurden city labels have **a narrow, somewhat transparent white blur**" (halo). No mask.
- **Forest/wood labels:** "The labels for woods use **an italic version of the IM Fell font. The letters are outlined in the same dark brown but filled with white, and there does not seem to be a mask or halo. The forest labels are also fairly small, about 60% or so the size of the town labels.**"
- **River labels:** "**a kind of 'negative' effect by using a transparent light color for the font and surrounding it with a dark halo.**" Caveat: "One problem with this style of label is that it can be hard to read on a busy background."
- **Ocean labels:** "Ocean labels are much as river labels, adjusted for the ocean colors."
- **Region labels:** "**Region labels are like forest labels, but not italic and in all-caps.**"

**Only ratio published: forest = ~60% of town label size. No absolute px sizes anywhere in the blog.**

Skies of Fire (https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html):
> "**Small caps is used for all labels except cities and rivers. Ocean and coastal labels are in a dark rust color. The larger labels have black outlines filled with brown, and the capital cities are underlined.** Underlining is the only element here I haven't done before. It's added using the CSS (or SVG) 'text-decoration' style."
> "I don't much like the way the underlining looks; it's too heavy and clunky. However, there doesn't seem to be a lot of control over this in CSS/SVG."

Western Torfani: "The Western Torfani map also uses **a dark gray color for labels.** My maps currently use **black**, but I can set the font color to the same dark gray."

LotR: "**red labels** and a cream colored background."

**No hex colors are published anywhere in the blog for label fills.** Colors are always described in words and sampled from reference maps.

### 4.3 `font-weight` + stroke incompatibility, and the `paint-order` fix

https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html — a genuinely non-obvious SVG gotcha, verbatim:

> "The italic version of the IM Fell font has characters that are a little too skinny at the size I need for the forest labels. In theory, that's not a problem, because you can change the thickness of fonts by using the CSS 'font-weight' style. … **However, I discovered that setting font-weight breaks the font stroke (outline). You can make the font fatter, or you can have an outline, but you can't have both.**"

> "This is probably because font outlining is done using the generic SVG shape stroking capability. The text is just treated as an SVG shape and then the perimeter of the shape is stroked to create an outline. Font weight, on the other hand, is a CSS style feature that presumably happens later in the display pipeline. If the shape is already stroked, it can't then be made fatter."

Failed workarounds (each documented as a dead end):
1. `-webkit-text-stroke` — "**doesn't seem to work on SVG text.**"
2. Two stacked copies, back one heavier via `font-weight` — "the difference in thickness between the heaviest and the lightest font weights is still pretty minimal, so that the stroke is very thin. … on a practical level, this doesn't work."
3. Two stacked copies, back one larger via `font-size` — "when the font changes size, the individual characters don't stay centered on each other. **The space between characters also gets bigger**, and this throws everything off."

**The working fix, verbatim:**
> "There's a little-known attribute for SVG text called **'paint-order'** which can be used to modify the order in which the fill, stroke and markers get drawn. **It turns out that when the stroke is drawn first (instead of the fill), 'font-weight' starts working!** I'm not entirely sure of the reasoning here, but I'll take it!"

> "(I later thought of another way to achieve this effect. Draw the text first with a thick outline, and then draw the text with no outline over the top. That might work.)"

### 4.4 Letter-spacing / tracking for region & ocean labels

https://heredragonsabound.blogspot.com/2019/01/naming-forests.html — verbatim; this is the **only** discussion of letter-spacing in the blog:

> "Another style often applied to these sorts of labels is to **stretch them out so that they better span the labeled area. Dragons Abound already does this for ocean labels**, so I can easily add this style to forest labels as well."
> "**It might be worthwhile to check the size of the forest area versus the length of the label to determine whether (or how much) extra letter spacing to apply.** Here's an example where a forest name ('Bishop Tanpik's Forest') has been **compressed** to make it fit better while another name with more room ('Forest of Horses') remains **stretched out**."
> "This is less than perfect; it relies on noticing ahead of time that there might be a problem and preemptively shrinking the label. And **it only works in cases where labels have added letter spacing.** A more robust algorithm might notice in the middle of label placement that a label has consistently been hard to place and then look for ways to make the label smaller."

⇒ Letter-spacing is **computed per label as a function of (area extent ÷ natural text length)**, applied to ocean, region and forest labels, and can go negative (compression). **No px/em values are published.** Also noted as an unimplemented gap in Skies of Fire (2018‑03): *"The reference map also stretches out region labels and turns them to fit their regions. This is something I haven't yet implemented."* — so tracking landed between 2018‑03 and 2019‑01.

### 4.5 `text-anchor` and `dominant-baseline` — verbatim SVG/d3 code

https://heredragonsabound.blogspot.com/2021/12/map-compasses-part-8-radial-text.html — the canonical d3 text-append idiom:

```javascript
    svg.append('text')
	  .attr('x', x)
	  .attr('y', y)
	  .style('font-family',font)
	  .style('fill', color)
	  .style('font-size', fontSize)
	  .style('font-style', fontStyle)
          .style('font-weight', fontWeight)
	  .text(text);
```
> "There are many possible attributes and styles that can be applied to SVG text elements but the above covers the ones we'll be using."

Full rotated-label version:
```javascript
function rtext(svg, center, radius, startAngle, repeats, angle, iteration, op) {
    let x = center[0];
    let y = center[1]-radius;
    svg.append('text')
	.attr('x', x)
	.attr('y', y)
	.style('font-family', op.font)
	.style('fill', op.color)
	.style('font-size', op.size)
	.style('font-style', op.style)
	.style('font-weight', op.weight)
	.style('text-anchor', 'middle')
	.attr('transform', 'rotate('+rad2degrees(angle-Math.PI/2)+','+center[0]+','+center[1]+')')
	.text(op.texts[iteration]);
};
```

Radial/vertical orientation switch (https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html):
```javascript
function rtext(svg, center, radius, startAngle, repeats, angle, iteration, op) {
    let x = center[0];
    let y = center[1]-radius;
    // If orientation == vertical, then rotate [x, y] around the center by
    // angle to find the spot for the label.
    if (op.orientation == 'vertical') {
	[x, y] = rotate(center, [x, y], angle-Math.PI/2);
    };
    // Now draw the label
    let label = svg.append('text')
	.attr('x', x)
	.attr('y', y)
	.style('font-family', op.font)
	.style('fill', op.color)
	.style('font-size', op.size)
	.style('font-style', op.style)
	.style('font-weight', op.weight)
	.style('text-anchor', 'middle')
	.text(op.texts[iteration]);
    // If orientation == radial, then we've drawn the label at 12 o'clock
    // and need to use SVG transform to rotate it around to the correct
    // spot.
    if (op.orientation != 'vertical') {
	label.attr('transform', 'rotate('+rad2degrees(angle-Math.PI/2)+','+center[0]+','+center[1]+')');
    };
};
```

**Anchor semantics, verbatim** (part 9):
> "That worked, but it has placed the text so that **the lower-left-hand corner of the text box is at the specified [x,y] location.** … To do this, SVG has a **text-anchor** attribute which I can set to **'middle'**." (part 8)
> "If you look at the code above you'll see that I'm setting the text-anchor of the label to 'middle'. **This is the middle of the bottom of the label**, so SVG is putting that spot at the tip of each of the compass points. … Instead of anchoring to the bottom of the text, in this case I should anchor to the center of the text. This can be accomplished with something called the **'dominant-baseline'** style. **Setting this to 'central'** does what we want" — with footnote: "**This setting doesn't really do exactly what we want, for reasons having to do with text complications like ascenders and descenders and the possibility of subscript accent marks and so on. But this gets pretty close in most cases.**"

**Width asymmetry warning** (part 9):
> "you can see that the placement of W and E are different. That's because **W is a wider character than E.** … I think for most compasses a 'close enough' approach is fine because the labels are usually the same number of characters."

Rotation syntax:
```
rotate(degrees, x, y)
```
> "Notice I needed a helper function 'rad2degrees' because my angles are in radians and the SVG command expects degrees."

Concrete font/size/weight values (https://heredragonsabound.blogspot.com/2022/03/map-compasses-part-14-lodestone-loader.html) — **the only literal font sizes in the blog:**
```
<twoLayerCompass> => <labels> REMEMBER("start") <bottomLayer> <topLayer>;
<$labelFont> => "Serif" | "Lobster" | "IM Fell English";
<$labelSize> => 14 | 16 | 18;
<$labelStyle> => "normal" | "bold" | "bolder";
<labels> => RTEXT(0, 4, <$labelFont>, <$labelSize>, "black", "", <$labelStyle>, "vertical", '["N", "E", "S", "W"]') SPACE(8);
```

### 4.6 Multi-line labels

https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html:
> "**because SVG doesn't support multi-line text, multi-line labels are actually collections of single line labels.**"

Used for islands (islands part three), bays (coast part five), and optionally oceans (naming of places part 8). Island names "always have at least two words, [so] it's possible to present them as a block text rather than a single line. … **This certainly helps reduce the map clutter.**"

### 4.7 Fake typesetting errors (the "hand-set type" flourish)

https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html — verbatim:
> "back in the old days of Linotype and older mechanical type setting, you'd get the occasional error where a letter was too low, too high or even a little rotated. This turns out to be pretty easy to recreate in SVG, because **SVG has the capability to rotate and offset individual letters within text.** So it's just a matter of going through each label with a small chance to tweak each letter within the label."

**The non-obvious part:**
> "It turns out that **when you apply an offset this way in SVG, it becomes the new baseline for subsequent characters. (Rotation doesn't work this way; it only affects a single character.) So to get a typesetting error look, I need to un-apply the offset on the next character.**"
> "It's easy to go overboard with this effect. **It's best to use it very sparingly and with small offsets** to create an almost-subliminal feeling of handcraft."

(Implementation: per-character `<tspan>` with `rotate` and `dy`, cancelling `dy` on the following character.)

---

## 5. HALOS, MASKS, AND TERRAIN KNOCKOUT

### 5.1 A label is THREE SVG elements

https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html — verbatim, the key structural fact:

> "the labels in Dragons Abound are not just simple SVG text elements. **Each label is actually three elements: the text element, a mask element, and a halo element.** This is evident when a label overlaps another map element … You can see the masking and halo effects particularly at the right end of the name where it overlaps the city icon."

And for curved labels there's a fourth, invisible piece:
> "some of the Dragons Abound labels are curved, which means they are set to **follow an (invisible) SVG path element.** Changing the position of these elements only slides them along the path. To move the label to a new position requires moving the underlying path."

### 5.2 Masking — full recipe

https://heredragonsabound.blogspot.com/2017/07/path-labels-part-five.html — verbatim:

> "**In SVG, you can add a mask to just about anything. The mask itself is a grayscale image. Everywhere the mask is white the image shows through; everywhere the mask is black the image is blocked out; and gray scales correspond to partial opacity.**"

> "**For text, you can create a useful mask by drawing the same text in black with a fatter pen -- that masks out around the edges of the text to whatever distance you've chosen. Then you place the mask not on the text, but on the image you want to block out. So in my case, I need to place the mask on the image of the mountains.**"

> "In many cases, it's easier to draw everything and then block out portions we want to remove than to not draw them in the first place. … **The mask is also separate from the image, so we can change the mask without changing the image. For example, during label placement I can just slide the mask around with the text.**"

Three variants, in escalating subtlety (crediting Jonathon Roberts / Fantastic Maps):
1. Hard mask — "makes a big difference in the readability of the label."
2. **Blurred mask** — "Jonathon Roberts recommends blurring the mask into the background, and letting some of the background show through. … This is a more subtle effect while still making the label more readable."
3. **White overlay instead of a mask** — "Jonathon Roberts actually does a white overlay on the background rather than a mask. **This has the advantage of also popping out a label even on a plain background (where the mask has no effect).** … I didn't expect to like this effect -- and I may continue to tweak it -- but I find that it does improve the definition and readability of the labels."

Known limitation:
> "One problem is that the effect is much more pronounced on a dark background like a forest. Unfortunately, **SVG doesn't provide a full array of compositing functionality. If I could use a screen blend mode, as Jonathon Roberts recommends, it would look better over a dark background.**"

### 5.3 Halo

The halo is distinct from the mask — per the Knurden post it is a **blurred, partially-transparent copy of the text behind the text**:
> "The second is a halo. **This is usually a white blur that surrounds the letters and also helps separate them from the background.** The Knurden city labels have a narrow, somewhat transparent white blur." (https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html)

Confirmed as a separate SVG element in the drag-and-drop post: *"the 'halo' (white blurred text behind the main text)."*

Style-dependent strength — Western Torfani: *"The Torfani map also uses larger and stronger 'halos' to offset the labels; I can duplicate this but I think the halo effect is a bit too strong on the Torfani map, so I'll stick with my default settings there."*

**Halos can be turned off, and then coastlines will clash** (https://heredragonsabound.blogspot.com/2020/11/d-style.html):
> "**Normally, labels get a halo around them that blocks out things like these coastlines so that the label is readable.** But I can't use that on a D&D style map and **I don't have the logic to avoid coast lines around labels.** So I'm going to leave this off."

Inkscape export gotcha (https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html):
> "Inkscape has some bugs in how it handles masks. Apparently Inkscape itself only creates masks with a single element … The workaround for that problem is to **group all the elements in each Dragons Abound mask into a single (unnecessary) 'group' element.**"

---

## 6. ADDITIONAL VERBATIM CODE

### 6.1 Drag handler for interactive label repositioning

https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html

```javascript
function dragged(d) {
  d3.select(this).attr("cx", d3.event.x).attr("cy", d3.event.y);
}
```
> "This takes the element that was clicked upon ('d3.select(this)') and sets its current position (cx, cy) to be the current position of the mouse (d3.event.x, d3.event.y)."

Three fixes he documents:
1. Use **relative** delta (`d3.event.dx`, `d3.event.dy`), else the label jumps to center under the cursor.
2. All three label elements (text + mask + halo) must move together. "The answer is to **create a specific drag event handler for each label as a Javascript closure** that has access to all the elements of the label."
3. **`pointer-events: none`** on the paper-texture overlay: "the map had a large (mostly transparent) image element covering the entire map … I had assumed that any element without an event handler would just ignore mouse clicks, but apparently that's not the case."

Rename-on-click: distinguish click from drag by whether position changed between mousedown and mouseup. Multi-line labels must be **deleted and recreated**, not edited: "the only approach that doesn't involve a lot of complicated bookkeeping is to delete the old label and replace it with a new label." Also: "**I'm generating a new name for each of the three parts of the label. Oops! Better to generate one new name and use it three times.**"

### 6.2 Non-label objects entering the label solver

Two features are treated as pseudo-labels so annealing places them:

- **Ocean illustrations** (https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html): "I just turn the image into a label and **make sure it has the criteria to maximize the distance to the nearest other label**."
- **Compasses** (https://heredragonsabound.blogspot.com/2019/08/looking-in-mirror.html): "I recently added the functionality to **treat a map compass like a label**. During the label-placing process, the compass moves around trying to find a good placement. In the case of a compass, this means in the middle of the ocean somewhere as far away from other features as possible."

Off-screen anchors (https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html): label placement only guarantees the *label* is visible, so features just off the map produce orphaned labels — needs an explicit "suppress if anchor off-map" rule.

### 6.3 Codebase scale (context for effort estimation)

https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html (11/27/17):
```
    Source lines of code:  36271
    Dead/removed lines of code: 6559
    Number of configuration parameters: ~1700
```

---

## 7. MINIMAL IMPLEMENTABLE RECIPE (synthesis — every number sourced above)

1. **Preload fonts.** Inject an empty visible `<span>` per WOFF2 family before any measurement. Non-negotiable — otherwise every bbox is a Helvetica fallback measurement.
2. **Measure by rendering.** Draw text, `getBBox()`, cache the (baseline-origin → bbox-origin → bbox-center) triple. Works identically for `<textPath>` text. Use bbox-center as the label position. Expect phantom padding above/below from descenders + SVG margin.
3. **Discretize obstacles into AABBs**: coastline/river/border per-segment boxes (watch the last segment); lakes as one whole box; city icons as boxes. Mountains/forests excluded — handled by masking.
4. **Index obstacles in a `d3.quadtree` keyed by feature center**; query with `qtWithinRect` (§2.7) padded by the largest feature's dimensions. ~90% of scoring time saved.
5. **Seed**: point labels at anchor; area labels at mapbox/polylabel visual center; ocean labels at the max-min-distance-to-edge interior point, then pushed 50% of that clearance radius toward the map edge, with a bonus for touching two edges.
6. **Anneal.** Per iteration pick a label with probability ∝ its current (bad) score. Generate a candidate by class:
   - point: displace, or rotate about anchor
   - area: random point in polygon (bbox rejection sampling) while hot → small displacements while cool
   - path: (position along path via `getTotalLength`/`getPointAtLength`, offset ±, arc amount), each drawn in a window around the current value that shrinks with temperature
   - angle as a 4th variable for straight labels, clamped to **[−45°, +45°]**
   Cap max move per iteration by label size. **Track and return best-ever** (+20%).
7. **Score** = Σ of the class-specific criteria (§1.3–1.5), with overlap penalties **weighted by overlap area**, offset penalized as deviation from a target of **½ label height**, and curviness via sinuosity. Add a tiny attraction to the seed point to break score plateaus.
8. **Collisions**: AABB×AABB for point/area labels; Sutherland-Hodgman (Mapbox impl) for path-label-polygon × feature-box; Greiner-Horman (Milevski) for path-label × path-label. Strip duplicate closing vertices before calling GH.
9. **Run ~1000 iterations** globally (2500/label is the ceiling). Drop path labels whose final curvature exceeds threshold; drop river labels where river length < **1.25–1.75×** label length.
10. **Render.** Region/ocean/coast/forest labels: build an elliptical arc path (rotate the ellipse via the arc's x-axis-rotation; reverse sweep on the lower half of the map; reverse the path direction to flip reading order), attach `<textPath startOffset="50%">` with `text-anchor="middle"`, plus a length-dependent fudge. River labels: Visvalingam at ~85% removal + neighbor averaging, then offset ribbon. Apply per-label letter-spacing = f(area extent / natural length), stretch or compress.
11. **Emit 3 elements per label**: halo (blurred, semi-transparent white copy, behind), text, and a mask (same text, fat stroke) applied to the *terrain* layer. Use `paint-order` with stroke first if you need `font-weight` **and** an outline. Multi-line labels = N single-line labels.
12. Optional flourish: per-character `<tspan>` rotate/`dy` typesetting errors, un-applying `dy` on the next character.

---

**Sources:** [Use the Force (Layout) Luke!](https://heredragonsabound.blogspot.com/2017/04/use-force-layout-luke.html) · [Simulated Annealing](https://heredragonsabound.blogspot.com/2017/05/simulated-annealing.html) · [Some Initial Optimizations for Label Placement](https://heredragonsabound.blogspot.com/2017/04/some-initial-optimizations-for-label.html) · [Area Labels](https://heredragonsabound.blogspot.com/2017/05/area-labels.html) · [Path Labels One](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-one.html) · [Two](https://heredragonsabound.blogspot.com/2017/04/path-labels-part-two.html) · [Three](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-three.html) · [Four](https://heredragonsabound.blogspot.com/2017/06/path-labels-part-four.html) · [Five](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-five.html) · [Six](https://heredragonsabound.blogspot.com/2017/07/path-labels-part-six.html) · [Labels Postscript (Seven)](https://heredragonsabound.blogspot.com/2017/07/labels-postscript-part-seven.html) · [Labeling the Ocean One](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-one.html) / [Two](https://heredragonsabound.blogspot.com/2017/09/labeling-ocean-part-two.html) · [Labeling the Coast One](https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-one.html) / [Two](https://heredragonsabound.blogspot.com/2017/09/labeling-coast-part-two.html) / [Three](https://heredragonsabound.blogspot.com/2017/10/labeling-coast-part-three.html) / [Four](https://heredragonsabound.blogspot.com/2017/10/labeling-coast-part-four.html) / [Five](https://heredragonsabound.blogspot.com/2017/11/labeling-coast-part-five.html) / [Six](https://heredragonsabound.blogspot.com/2017/11/labeling-coast-part-six.html) · [Labeling Islands Three](https://heredragonsabound.blogspot.com/2017/11/labeling-islands-part-three.html) · [Various Miscellany, Part 2 (2017-04)](https://heredragonsabound.blogspot.com/2017/04/various-miscellany-part-2.html) · [Various Miscellany (Part 2) (2017-11)](https://heredragonsabound.blogspot.com/2017/11/various-miscellany-part-2.html) · [Towards Idiomatic Javascript](https://heredragonsabound.blogspot.com/2017/04/towards-idiomatic-javsascript.html) · [Recreating a Style](https://heredragonsabound.blogspot.com/2017/10/recreating-style.html) · [Skies of Fire](https://heredragonsabound.blogspot.com/2018/03/recreating-map-style-skies-of-fire.html) · [Naming of Places 8: The Sea](https://heredragonsabound.blogspot.com/2018/07/the-naming-of-places-part-8-sea.html) · [Naming of Places 12: Map Interaction](https://heredragonsabound.blogspot.com/2018/08/the-naming-of-places-part-12-map.html) · [Various Miscellany (Part 3)](https://heredragonsabound.blogspot.com/2018/08/various-miscellany-part-3.html) · [Lord of the Rings Map Style](https://heredragonsabound.blogspot.com/2018/10/lord-of-rings-map-style.html) · [Continent Maps Part 2](https://heredragonsabound.blogspot.com/2018/10/continent-maps-part-2-getting.html) · [Naming Forests](https://heredragonsabound.blogspot.com/2019/01/naming-forests.html) · [Map Borders Part 15](https://heredragonsabound.blogspot.com/2019/07/map-borders-part-15.html) · [Looking in the Mirror](https://heredragonsabound.blogspot.com/2019/08/looking-in-mirror.html) · [Hand-drawn D&D Style](https://heredragonsabound.blogspot.com/2020/11/d-style.html) · [Knurden Style: Labels & Etc](https://heredragonsabound.blogspot.com/2021/02/knurden-style-labels-etc-part-6.html) · [Map Compasses 8: Radial Text](https://heredragonsabound.blogspot.com/2021/12/map-compasses-part-8-radial-text.html) · [Map Compasses 9: Vertical Text and Radial Arcs](https://heredragonsabound.blogspot.com/2022/01/map-compasses-part-9-vertical-text-and.html) · [Map Compasses 14](https://heredragonsabound.blogspot.com/2022/03/map-compasses-part-14-lodestone-loader.html)

agentId: a1629a8513d2f1082 (use SendMessage with to: 'a1629a8513d2f1082', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 203786
tool_uses: 54
duration_ms: 710870</usage>