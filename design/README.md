# DukaanOS UI design

Mobile mockups (390x844) for the core screens: Billing, Voice billing, Stock tips, Sales.

- `source/` - editable Claude Design files (`*.dc.html` + `canvas.json`). Open in Claude Design to edit and click through.
- `screens/` - PNG previews of each screen.

## Look
| Token | Value |
|---|---|
| Background (cream) | `#FBF6EC` |
| Primary (deep green) | `#0F5B3E` |
| Accent (turmeric) | `#E8A317` |
| Text | `#1F2A24` / muted `#5C655F` |
| Card border | `#E6DCC8` |
| Alert red | `#B3331D` |

Fonts: Baloo 2 (headings, numbers) and Mukta (body), both from Google Fonts and both cover Devanagari.

## Notes
- PNGs were rendered in a sandbox without Google Fonts, so they show fallback fonts. The `source/` files load the real fonts.
- All figures are sample data (Sri Lakshmi Kirana demo store).
- Design principles: 48px+ touch targets, big totals, plain-language tips (no jargon), colour never the only signal.
- Not yet applied to the Flutter code in `mobile/`.
