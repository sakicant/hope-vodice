# Logotip — radna verzija

Smjer A: **svjetionik je slovo E**. Odobreno kao radna verzija 10.11.2026.
**Bernard još nije potvrdio** — dok ne potvrdi, sve ovdje se može mijenjati.

## Datoteke

| Datoteka | Za što | Tekst pretvoren u krivulje |
|---|---|---|
| `favicon.svg` | favicon, avatar na Booking.com i Facebooku | nema teksta |
| `logo-mark.svg` | sam svjetionik, `currentColor` — boji se CSS-om | nema teksta |
| `logo-e.svg` | slovo E izdvojeno, za pečate i sitne primjene | nema teksta |
| `logo-full.svg` | okomiti logotip (HOPE + val + APARTMANI + zvjezdice) | **ne** |
| `logo-horizontal.svg` | zaglavlje stranice | **ne** |

## Otvoreno: krivulje

`logo-full.svg` i `logo-horizontal.svg` još imaju "HOP" kao `<text>` u Montserrat 800.

To radi **samo tamo gdje je font učitan** — dakle na našoj stranici, ako logotip
ubacimo kao inline `<svg>` u HTML. Ne radi pouzdano kad se datoteka otvori sama,
pošalje Bernardu, pošalje tiskari ili učita kao `<img src="logo-full.svg">`:
tada font nedostaje i slova odskaču na zamjenski font.

Rješenje je pretvoriti slova u krivulje (`<path>`). Za to treba Montserrat 800
TTF i jedan prolaz kroz `fontTools`. `fontTools 4.64.0` je već na računalu.

Dok se to ne napravi:

- u zaglavlje stranice ide **inline `<svg>`**, ne `<img>`
- za sve izvan stranice koristi `favicon.svg`, `logo-mark.svg` ili `logo-e.svg`

## Boje

Definirane u [`../brand.css`](../brand.css).

| | |
|---|---|
| Plava | `#0B7FC4` |
| Zlatna | `#E8A838` |
| Tamna (podloge) | `#0A2E45` |
| Tekst uz logotip | `#0A3D62` |

## Pravila korištenja

- **Najmanja visina** okomitog logotipa: 64 px. Ispod toga ide `logo-horizontal.svg`.
- **Najmanja širina** vodoravnog: 120 px. Ispod toga ide samo `logo-mark.svg`.
- **Prazan prostor** oko logotipa: najmanje visina fenjera svjetionika sa svake strane.
- Na tamnoj podlozi sve je bijelo osim zraka, koje ostaju zlatne.
- Logotip se ne rasteže, ne rotira, ne stavlja na fotografiju bez tamnog sloja ispod.

## Pismo

Montserrat 800 za logotip i naslove, Jost 300/400/500 za tekst.
Oba su s Google Fontsa, besplatna za komercijalnu upotrebu (SIL OFL).

## Odakle je nastao

Prethodni logo (2025) i sva analiza stare stranice su u `scrape/` — vidi
`scrape/INVENTORY.md`. Mapa `scrape/` se ne commita.
