# Logotip — radna verzija

Smjer A: **svjetionik je slovo E**. Odobreno kao radna verzija 10.11.2026.
**Bernard još nije potvrdio** — dok ne potvrdi, sve ovdje se može mijenjati.

Sva slova su pretvorena u krivulje. Nijedna datoteka ne treba font da bi se
ispravno prikazala — rade kao `<img>`, kao pozadina, u mailu, u tisku, bilo gdje.

## Datoteke

| Datoteka | Za što |
|---|---|
| `favicon.svg` | favicon, avatar na Booking.com i Facebooku |
| `logo-mark.svg` | sam svjetionik, bez kvadrata |
| `logo-e.svg` | slovo E izdvojeno, sa zrakama |
| `logo-full.svg` | okomiti logotip — HOPE, val, APARTMANI, tri zvjezdice |
| `logo-horizontal.svg` | zaglavlje stranice |
| `logo-horizontal-white.svg` | isto, za tamne podloge i footer |
| `preview.html` | sve veličine na jednom mjestu, za provjeru |

Pregled: `python -m http.server 5700` iz korijena projekta, pa otvori
`http://127.0.0.1:5700/assets/logo/preview.html`.

## Bojanje iz CSS-a

Boje su upisane u datoteke (`#0B7FC4`), da rade i kad se učitaju kao `<img>`.
Ako logotip treba pratiti boju teksta, ubaci SVG **inline u HTML** i zamijeni
`fill="#0B7FC4"` s `fill="currentColor"`. Kao `<img>` to ne radi — vanjska
datoteka nema CSS kontekst i `currentColor` ispadne crn.

## Boje

Definirane u [`../brand.css`](../brand.css).

| | |
|---|---|
| Plava | `#0B7FC4` |
| Zlatna (zrake, zvjezdice) | `#E8A838` |
| Tamna (podloge) | `#0A2E45` |
| Tekst uz logotip | `#0A3D62` |

## Pravila korištenja

- **Najmanja visina** okomitog logotipa: 96 px. Ispod toga ide `logo-horizontal.svg`.
- **Najmanja širina** vodoravnog: 120 px. Ispod toga ide samo `logo-mark.svg` ili `favicon.svg`.
- **Prazan prostor** oko logotipa: najmanje visina fenjera svjetionika sa svake strane.
- Na tamnoj podlozi sve je bijelo osim zraka, koje ostaju zlatne.
- Logotip se ne rasteže, ne rotira, ne stavlja na fotografiju bez tamnog sloja ispod.

### Favicon na 16 px

Na 16 px (kartica preglednika) svjetionik se stapa u plavu mrlju — to je
granica oblika, ne greška u datoteci. Na 32 px i više čita se uredno.
Ako nam 16 px postane važan, treba zasebna pojednostavljena verzija.

## Pismo

Montserrat 800 za logotip i naslove, Jost 300/400/500 za tekst.
Oba su s Google Fontsa, besplatna za komercijalnu upotrebu (SIL OFL).

Slova u logotipu su izvučena iz varijabilnih verzija oba fonta
(`wght` 800 odnosno 400) preko `fontTools` i zapečena u `<path>`.
Fontovi se ne nalaze u repozitoriju.

## Odakle je nastao

Prethodni logo (2025) i sva analiza stare stranice su u `scrape/` — vidi
`scrape/INVENTORY.md`. Mapa `scrape/` se ne commita.
