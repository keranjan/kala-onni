# 🎣 Kala-Onni

Paikkatietopohjainen kalastuskartta: näet lähialueesi kalapaikat, niiden
todennäköiset kalalajit sekä sääennusteen ja vuorokauden parhaat kalastusajat.

Sovellus on riippuvuudeton staattinen web-sovellus – ei palvelinta, ei
rekisteröitymistä eikä API-avaimia. Kaikki data haetaan ilmaisista avoimista
rajapinnoista suoraan selaimessa. Puhelimessa se toimii kuin natiivi sovellus:
sen voi asentaa kotivalikkoon ja se avautuu myös ilman verkkoyhteyttä.

## Ominaisuudet

**Kartta ja kalapaikat**
- Paikannus selaimen sijainnilla, paikkakuntahaku tai kartan napautus
- Sijainnin seuranta kartalla: piste liikkuu mukana, etäisyydet päivittyvät
  sitä mukaa kun liikut, ja kartta pysyy keskitettynä sinuun. Kartan
  tarttuminen lopettaa keskittämisen – painike keskittää takaisin, toinen
  painallus lopettaa seurannan
- Kun karttaa selaa pois hakualueelta, ilmestyy “Hae tältä alueelta”
- Lähialueen kohteet OpenStreetMapista 5–50 km säteellä: merkityt
  kalastuspaikat, järvet, joet, lammet, laiturit ja veneluiskat
- Haku tehdään kahdessa osassa: merkityt kalastuspaikat vastaavat nopeasti ja
  näkyvät heti, raskaampi vesistöhaku täydentää listaa perässä
- Jos toinen puolisko ei vastaa, toinen näytetään silti – ja jos Overpass on
  kokonaan alhaalla, näytetään viimeksi haetut tiedot niiden iän kera
- Kohteet on väri- ja ikonikoodattu tyypeittäin: kalapaikat ja laiturit,
  järvet ja lammet, joet ja kosket, meri sekä muut vesialueet
- Jokaisen tyypin voi piilottaa suodatinpainikkeilla – ne ovat sekä kartalla
  että paneelissa, näyttävät osumien määrän ja muistetaan seuraavalle kerralle
- Etäisyys näkyy jokaisessa kohteessa
- Jaettava linkki: sijainti ja hakusäde tallentuvat osoitteen loppuun

**Omat paikat ja saalispäiväkirja**
- Tallenna oma apaja kartan keskipisteestä tai nykyisestä sijainnista – myös
  sellainen, jota OpenStreetMap ei tunne. Omat paikat näkyvät hakutulosten
  joukossa omalla tähtimerkillään ja omalla suodattimellaan
- Kirjaa saalis kahdella napautuksella: laji, pituus ja pyyntitapa. Sää,
  kalaonni ja vuorokaudenaika tallentuvat automaattisesti mukaan
- Päiväkirja kertoo yhteenvedon: yleisin laji, paras vuorokaudenaika, suurin
  kala ja paras paikka – ja kalapaikkalistassa näkyy “olet saanut täältä
  ahventa ×3, useimmiten iltahämärässä”
- Kaikki tallentuu vain laitteelle. Varmuuskopion voi viedä ja tuoda JSON-
  tiedostona, eikä sitä koskaan siivota välimuistin mukana

**Kalalajit**
- 16 Suomen yleisintä saalislajia järvistä, joista ja mereltä
- Kaksi eri lukua, kumpikin nimettynä: **esiintyminen** (%) kertoo, onko laji
  tässä vedessä nyt – vesityypin, leveysasteen ja kuukauden perusteella –
  ja **kalaonni** (0–100) kertoo, onko juuri nyt hyvä hetki sen pyyntiin
- Jokainen kortti avaa pyynnöstä erittelyn “Miksi esiintyminen on X %?”, ja
  paneeli selittää molemmat luvut omassa osiossaan
- Jos vesityyppiä ei saada selville, se sanotaan suoraan ja arviot pidetään
  varovaisina – arvio tarkentuu itsestään, kun vesistöhaku valmistuu
- Jokaisesta lajista pyyntitavat, parhaat vuorokaudenajat, paikkavinkit sekä
  alamitta ja rauhoitusaika, kun sellainen on
- Lajin valinta painottaa kalasään uudelleen juuri sille lajille

**Mobiilikäyttö**
- Koko näytön kartta ja vedettävä alapaneeli kolmella korkeudella: kurkistus,
  puolikas ja koko näyttö – vedä kahvasta tai listan yläreunasta
- Paikannus peukalon ulottuvilla olevana painikkeena, joka pysyy aina paneelin
  yläpuolella; kaikki kosketuskohteet vähintään 44 × 44 px
- Tuntikuvaajaa selataan sormella, ja pystypyyhkäisy vierittää normaalisti
- Lovet ja kotipainikepalkit huomioitu (`safe-area`), eikä osoitepalkin
  liuku hyppäytä asettelua (`dvh`)
- Vaakanäytöllä paneeli siirtyy näytön reunaan kartan viereen
- Asennettavissa kotivalikkoon (PWA) ja toimii offline-tilassa: sovellus,
  kartan ruudut ja viimeisin ennuste tulevat välimuistista

**Kalasää ja parhaat ajat**
- Kalaonni-pisteet 0–100 jokaiselle tunnille seuraavan 48 tunnin ajalle
- Kolme parasta kalastusjaksoa perusteluineen
- Tuntikuvaaja, jossa yöajat on varjostettu, paras jakso merkitty ja
  auringonnousu (▲) ja -lasku (▼) omalla merkillään akselin alla
- Erittely siitä, mistä pisteet muodostuvat – jokainen tekijä nimettynä
- Sään tunnusluvut: lämpötila, tuuli ja puuskat, pilvisyys, sade,
  ilmanpaine ja sen muutos sekä kuun vaihe
- Auringonnousu ja -lasku omina tietoinaan kellonaikoineen, päivän pituus ja
  huomisen ajat – pohjoisessa kerrotaan myös yötön yö ja kaamos
- Jokaisella sääruudulla oma ikoninsa: sää säätilan mukaan, lämpömittari,
  tuuli, pilvisyys, ilmanpainemittari, auringonnousu ja -lasku, päivän pituus
  ja kuu, joka piirtyy sen hetkisen vaiheen mukaan
- Arvio annetaan kalastajan kielellä: **äärimmäisen kireitä siimoja**,
  kireitä, löysähköjä, löysiä ja erittäin löysiä siimoja
- Vaalea ja tumma teema, näppäimistökäyttö ja taulukkonäkymä kuvaajan rinnalla

## Käynnistys

Sovellus on pelkkiä staattisia tiedostoja, joten mikä tahansa web-palvelin käy:

```bash
npm start           # python3 -m http.server 5173
# avaa http://localhost:5173
```

Puhelimella samassa verkossa: avaa `http://<koneen-ip>:5173`. Asennus
kotivalikkoon ja offline-tuki vaativat `https`-yhteyden, eli käytännössä
julkaistun osoitteen.

> Selaimen paikannus vaatii `https`- tai `localhost`-yhteyden. Tiedoston
> avaaminen suoraan `file://`-osoitteesta ei toimi, koska sovellus käyttää
> ES-moduuleja.

Julkaisu onnistuu sellaisenaan mihin tahansa staattiseen palveluun
(GitHub Pages, Netlify, Cloudflare Pages).

## Testit

```bash
npm test            # pisteytyksen ja lajisovituksen yksikkötestit (node --test)
npm run smoke       # selaintesti Playwrightilla, kuvakaappaukset test/screenshots/
npm run icons       # generoi sovelluskuvakkeet uudelleen
```

Selaintesti ajaa kolme läpikäyntiä: työpöytä, puhelin (kosketus, alapaneelin
vedot, kosketuskohteiden koot, vaakanäyttö) ja offline-tila, jossa sovelluksen
pitää latautua service workerin välimuistista.

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

Pisteet näytetään sanallisena arviona: 78–100 äärimmäisen kireitä siimoja,
64–77 kireitä, 50–63 löysähköjä, 34–49 löysiä ja alle 34 erittäin löysiä
siimoja.

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
| [Leaflet](https://leafletjs.com) | karttakomponentti (mukana `assets/vendor/`, ei CDN-riippuvuutta) |

Kaikki ovat ilmaisia ja avoimia palveluita. Vastaukset välimuistitetaan
selaimeen (kalapaikat 6 h, sää 30 min), jotta palveluita ei kuormiteta turhaan.
Overpass-peilipalvelimia käytetään vuorotellen satunnaisesta aloituskohdasta,
ja haulla on kokonaisaikabudjetti – odottaminen ei jatku loputtomiin, vaan
käyttäjä saa sen mikä ehti valmistua.

## Luvat ja säännöt

Sovellus ei korvaa virallisia kalastussääntöjä. 18–69-vuotiaat tarvitsevat
valtion kalastonhoitomaksun, ja vesialueella voi olla omia lupia, alamittoja ja
rauhoituksia.

- Rajoitukset ja rauhoitusalueet: [kalastusrajoitus.fi](https://kalastusrajoitus.fi)
- Luvat ja kalastonhoitomaksu: [eraluvat.fi](https://eraluvat.fi)

## Rakenne

```
index.html            sivupohja
manifest.webmanifest  PWA-määrittely (asennus kotivalikkoon)
sw.js                 service worker: offline-välimuisti
assets/styles.css     teemamuuttujat ja ulkoasu (vaalea + tumma, työpöytä + mobiili)
assets/icons/         sovelluskuvakkeet
assets/vendor/        Leaflet paikallisena kopiona
src/app.js            sovelluslogiikan kokoaminen ja tila
src/sheet.js          mobiilin alapaneeli ja sen eleet
src/map.js            Leaflet-kartta, merkinnät ja säde
src/spots.js          Overpass-haku ja vesialueiden luokittelu
src/spot-types.js     kohdetyyppien kategoriat, värit ja suodattimet
src/store.js          käyttäjän oman datan tallennus (ei koskaan välimuistia)
src/logbook.js        omat paikat, saaliit ja niistä johdetut yhteenvedot
src/journal-view.js   päiväkirjanäkymä sekä paikka- ja saalislomakkeet
src/species.js        kalalajitietokanta ja lajisovitus
src/weather.js        Open-Meteo-haku ja normalisointi
src/score.js          kalaonnen pisteytys ja parhaat jaksot
src/chart.js          tuntikuvaaja (SVG) ja taulukkonäkymä
src/icons.js          sääikonit inline-SVG:nä, kuu oikeassa vaiheessa
src/ui.js             paneelinäkymien renderöinti
src/geo.js            paikannus ja paikkahaku
src/util.js           apufunktiot
tools/make-icons.mjs  kuvakkeiden generointi
test/                 yksikkötestit, selaintesti ja testikiinnikkeet
```

## Lisenssi

MIT. Karttadata © OpenStreetMapin tekijät (ODbL).
