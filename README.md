# 🎣 Kala-Onni

Paikkatietopohjainen kalastuskartta: näet lähialueesi kalapaikat, niiden
todennäköiset kalalajit sekä sääennusteen ja vuorokauden parhaat kalastusajat.

Sovellus on riippuvuudeton staattinen web-sovellus – ei palvelinta, ei
rekisteröitymistä eikä API-avaimia. Kaikki data haetaan ilmaisista avoimista
rajapinnoista suoraan selaimessa.

## Ominaisuudet

**Kartta ja kalapaikat**
- Paikannus selaimen sijainnilla, paikkakuntahaku tai kartan napautus
- Lähialueen kohteet OpenStreetMapista 5–50 km säteellä: merkityt
  kalastuspaikat, järvet, joet, lammet, laiturit ja veneluiskat
- Merkityt kalastuspaikat erottuvat omalla merkillään, ja etäisyys näkyy
  jokaisessa kohteessa
- Jaettava linkki: sijainti ja hakusäde tallentuvat osoitteen loppuun

**Kalalajit**
- 16 Suomen yleisintä saalislajia järvistä, joista ja mereltä
- Lajiarvio perustuu vesityyppiin, sijainnin leveysasteeseen ja kuukauteen
- Jokaisesta lajista pyyntitavat, parhaat vuorokaudenajat, paikkavinkit sekä
  alamitta ja rauhoitusaika, kun sellainen on
- Lajin valinta painottaa kalasään uudelleen juuri sille lajille

**Kalasää ja parhaat ajat**
- Kalaonni-pisteet 0–100 jokaiselle tunnille seuraavan 48 tunnin ajalle
- Kolme parasta kalastusjaksoa perusteluineen
- Tuntikuvaaja, jossa yöajat on varjostettu ja paras jakso merkitty
- Erittely siitä, mistä pisteet muodostuvat – jokainen tekijä nimettynä
- Sään tunnusluvut: lämpötila, tuuli ja puuskat, pilvisyys, sade,
  ilmanpaine ja sen muutos, auringonnousu ja -lasku sekä kuun vaihe
- Vaalea ja tumma teema, näppäimistökäyttö ja taulukkonäkymä kuvaajan rinnalla

## Käynnistys

Sovellus on pelkkiä staattisia tiedostoja, joten mikä tahansa web-palvelin käy:

```bash
npm start           # python3 -m http.server 5173
# avaa http://localhost:5173
```

> Selaimen paikannus vaatii `https`- tai `localhost`-yhteyden. Tiedoston
> avaaminen suoraan `file://`-osoitteesta ei toimi, koska sovellus käyttää
> ES-moduuleja.

Julkaisu onnistuu sellaisenaan mihin tahansa staattiseen palveluun
(GitHub Pages, Netlify, Cloudflare Pages).

## Testit

```bash
npm test            # pisteytyksen ja lajisovituksen yksikkötestit (node --test)
npm run smoke       # selaintesti Playwrightilla, kuvakaappaukset test/screenshots/
```

Selaintesti tarjoilee sovelluksen paikallisesti ja vastaa kaikkiin ulkoisiin
pyyntöihin `test/fixtures.mjs`-kiinnikkeillä, joten se ei tarvitse verkkoa eikä
kuormita ilmaisia rajapintoja.

## Miten kalaonni lasketaan

Lähtöarvo on 50 pistettä, jota jokainen tekijä nostaa tai laskee. Ääripäitä
pehmennetään, jotta huippuhetket erottuvat toisistaan.

| Tekijä | Vaikutus |
|---|---|
| Vuorokaudenaika | Aamu- ja iltahämärä ovat useimmille lajeille parhaita; yö ja kirkas keskipäivä heikoimpia |
| Tuuli | Noin 1,5–6 m/s väreilyttää pinnan sopivasti; tyyni ja kova tuuli heikentävät |
| Ilmanpaine | Vakaa tai hitaasti laskeva paine on hyvä, jyrkkä nousu tai romahdus huono |
| Pilvisyys | Vaihteleva tai pilvinen suojaa kaloja; kirkas taivas passivoi |
| Sade | Kevyt sade aktivoi, kaatosade heikentää |
| Lämpötila | Verrataan lajin ihannelämpötilaan (ilman lämpötila veden korvikkeena) |
| Kuun vaihe | Uusi- ja täysikuu antavat solunar-teorian mukaisen lisän |

Valittu kohdelaji muuttaa painotuksia: made pisteyttää yöt korkealle, ahven
päivän, kuha hämärän ja tuulisen sään, taimen pilvisen ja sateisen kelin.

**Malli on kalastajan nyrkkisääntö, ei tieteellinen ennuste.** Se ei tunne
veden lämpötilaa, kutuvaiheita, istutuksia eikä paikallisia olosuhteita.

## Tietolähteet

| Lähde | Käyttö |
|---|---|
| [OpenStreetMap](https://www.openstreetmap.org) / Overpass API | kalapaikat, vesistöt, laiturit |
| [Open-Meteo](https://open-meteo.com) | sääennuste 3 vrk, tunnin tarkkuudella |
| [Nominatim](https://nominatim.openstreetmap.org) | paikkahaku ja käänteinen geokoodaus |
| [Leaflet](https://leafletjs.com) | karttakomponentti |

Kaikki ovat ilmaisia ja avoimia palveluita. Vastaukset välimuistitetaan
selaimeen (kalapaikat 6 h, sää 30 min), jotta palveluita ei kuormiteta turhaan.

## Luvat ja säännöt

Sovellus ei korvaa virallisia kalastussääntöjä. 18–69-vuotiaat tarvitsevat
valtion kalastonhoitomaksun, ja vesialueella voi olla omia lupia, alamittoja ja
rauhoituksia.

- Rajoitukset ja rauhoitusalueet: [kalastusrajoitus.fi](https://kalastusrajoitus.fi)
- Luvat ja kalastonhoitomaksu: [eraluvat.fi](https://eraluvat.fi)

## Rakenne

```
index.html            sivupohja
assets/styles.css     teemamuuttujat ja ulkoasu (vaalea + tumma)
src/app.js            sovelluslogiikan kokoaminen ja tila
src/map.js            Leaflet-kartta, merkinnät ja säde
src/spots.js          Overpass-haku ja vesialueiden luokittelu
src/species.js        kalalajitietokanta ja lajisovitus
src/weather.js        Open-Meteo-haku ja normalisointi
src/score.js          kalaonnen pisteytys ja parhaat jaksot
src/chart.js          tuntikuvaaja (SVG) ja taulukkonäkymä
src/ui.js             paneelinäkymien renderöinti
src/geo.js            paikannus ja paikkahaku
src/util.js           apufunktiot
test/                 yksikkötestit, selaintesti ja testikiinnikkeet
```

## Lisenssi

MIT. Karttadata © OpenStreetMapin tekijät (ODbL).
