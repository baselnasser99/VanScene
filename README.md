<h1 align="center">
  <img alt="VanScene" src="docs/logo/vanscene-horizontal.svg#gh-light-mode-only" height="64">
  <img alt="VanScene" src="docs/logo/vanscene-horizontal-reversed.svg#gh-dark-mode-only" height="64">
</h1>

<p align="center"><b>See where and when crime is reported in Vancouver, in plain language.</b></p>

<p align="center">
  <a href="https://vanscene.vercel.app"><img alt="Open VanScene" src="https://img.shields.io/badge/Open_VanScene-live-2ea44f"></a>
  <a href="https://geodash.vpd.ca/opendata/"><img alt="Data: VPD GeoDASH open data" src="https://img.shields.io/badge/Data-VPD_GeoDASH-6e7781"></a>
</p>

<!-- The #gh-*-mode-only endings follow the reader's GitHub theme; <picture> would follow the OS theme instead -->
<img alt="VanScene: picking 2025 and theft from cars, opening an area near Mount Pleasant, comparing it with Kitsilano, then the city-wide trends" src="docs/vanscene-demo.gif#gh-light-mode-only">
<img alt="VanScene: picking 2025 and theft from cars, opening an area near Mount Pleasant, comparing it with Kitsilano, then the city-wide trends" src="docs/vanscene-demo-dark.gif#gh-dark-mode-only">

VanScene turns the Vancouver Police Department's open crime data into a map you can read at a glance. It's for people choosing a neighbourhood or getting to know one: compare areas, see what kinds of incidents get reported there and at what time of day, and check whether a year was unusual.

> [!IMPORTANT]
> **It shows reported incidents, not a safety rating.** Busy places show more because more people are there. Use it as one input next to visiting the area and talking to people who live there.

<p align="center">
  <a href="#what-ive-built">What I've built</a> ·
  <a href="#what-you-can-do">What you can do</a> ·
  <a href="#a-one-minute-walkthrough">Walkthrough</a> ·
  <a href="#about-the-data">About the data</a> ·
  <a href="#run-it-locally">Run it locally</a> ·
  <a href="#how-its-built">How it's built</a> ·
  <a href="#responsible-use-and-disclaimer">Responsible use</a> ·
  <a href="#credits">Credits</a>
</p>

---

## What I've built

VanScene started as my team's entry to the Build Trilemma Datathon 2026 (see [Credits](#credits)). Since the datathon I've kept building it, and most of the app as it is today is my work. To see where it started, the team's [60-second demo](https://youtu.be/DbSOYitXOZY) shows VanScene as it was presented at the datathon, before these changes:

- **The map:** clearer colours and labels, smooth zooming that follows the scroll wheel, a green-to-red heat map that redraws as you zoom so hotspots split and merge, and a calm dark mode.
- **The look:** a frosted sidebar that slides away, the Fold logo, and raised search and filter fields.
- **Phones:** a full-screen map with the views and search in a floating bar at the bottom, a frosted sheet for the filters that follows your finger, cards you swipe away, the heat fading in smoothly, and 44 px touch targets, tested on a real phone.
- **Clearer charts:** 2026 drawn at its full-year pace, time-of-day shares that add up to 100%, and the busiest day and hour in words.
- **Fairer comparisons:** one fixed heat scale so years and crime types compare honestly, four equal six-hour parts of the day, single hours you can pick, and two areas side by side in Compare.
- **Shareable links:** the view and filters are saved in the address, so a link opens the same map.
- **Accessibility:** a one-line summary of every chart for screen readers, full keyboard use (arrow keys on the hour bars too), and AA contrast throughout.
- **Fresh data:** the police data refreshes itself every Sunday with GitHub Actions, and a failed run opens an issue the whole team can see.
- **Safe updates:** new data goes live only if the app can read it and it has no more than 5% fewer incidents than before, since a big drop usually means a broken download.
- **Speed:** `data.json` is stored column by column, so it downloads about 45% smaller and starts before the scripts load, and a filter change redraws the heat in about 40 ms instead of 72.
- **Tests and CI:** tests for the data pipeline and a syntax check of the app run on every pull request and push to `main`.
- **Security:** crime-type and neighbourhood names that could become HTML are refused before publishing, and the CDN map libraries are pinned with SRI hashes, so a changed file is refused instead of run.

## What you can do

- **Read the map.** A heat map of reported incidents across the City of Vancouver, from green where reports cluster, through yellow, to red where they are densest; streets with only the odd report stay clear. The colour scale stays the same across years, so 2019 and 2025 can be compared directly.
- **Filter it.** Pick any years from 2016 on, a crime type (for example "Home break-ins" or "Bike theft"), and a time of day. The day is split into four equal six-hour parts, so they compare fairly. You can also click or drag across single hours on the chart under them.
- **Look at one spot.** Click anywhere for a summary of what was reported within 500 metres: how it compares with the city average for a circle that size, the most common types, when they happen, and year by year. It also shows offences against a person for the whole neighbourhood the spot is in, since VPD gives those no map location.
- **Search a neighbourhood** to jump straight to it.
- **Compare two areas.** Place A and B, and both are listed side by side: counts, change from the year before, and each area's top crime types with their share of its reports.
- **See the trend.** Trends shows the whole city year by year and hour by hour, with reports per day.
- **Share what you see.** The link keeps the view, years, crime type, hours and the spots you picked.
- **Use it your way.** It works on phones (the views sit in a bar at the bottom), with a keyboard, with a screen reader, and in light or dark mode. On wider screens the filters slide away to give the map the whole width.

## A one-minute walkthrough

You've just moved to Vancouver and you're choosing between two apartments, one in Mount Pleasant and one in Kitsilano.

1. Pick the years you care about, for example 2025 and 2026.
2. Drag across the evening hours on the time-of-day chart, if evenings are when you'll be out.
3. Click near the Mount Pleasant apartment to see what's been reported around it and how that compares with the city.
4. Open **Compare**, then click near the Kitsilano apartment. The two areas line up side by side.
5. Check **Trends** to see whether one year was unusual.

Instead of reading Reddit threads or asking about one area at a time, you see both places on the same data, with the source and its limits in the app.

## About the data

- **Source:** Vancouver Police Department, [GeoDASH Open Data](https://geodash.vpd.ca/opendata/). To look up single incidents, use VPD's own [GeoDASH crime map](https://geodash.vpd.ca/).
- **What's in it:** about 375,000 mapped incidents from January 2016 to the latest weekly update. These are incidents police confirmed happened ("founded"), dated by when they occurred.
- **How it's counted:** VPD counts every offence in an incident ("All Offence" counting), while Statistics Canada counts only the most serious one. So VanScene's totals can't be compared with Statistics Canada crime figures or rates.
- **Kept up to date:** a GitHub Action refreshes it every Sunday after VPD republishes, with a backup run on Tuesdays. The app shows the date of the last update under the map key.
- **Where it's approximate:** VPD offsets every location for privacy. Property crime is moved to the hundred block, and offences against a person are spread across several blocks. That's why the map stops at street level and summaries use a 500 m circle.
- **What isn't on the map:** violent crime ("offence against a person" and homicide) has no location in VPD's data, so it can't be mapped. VPD still names its neighbourhood, so clicking a spot shows that neighbourhood's count, using the City of Vancouver's [local-area boundaries](https://opendata.vancouver.ca/explore/dataset/local-area-boundary/) (Open Government Licence – Vancouver) to tell which neighbourhood the spot is in.

The full limitations are under [Responsible use](#responsible-use-and-disclaimer) and in the [datathon write-up](docs/datathon.md).

### Data licence

The VPD confirmed by email in November 2026 that GeoDASH data is for **free, non-commercial public use only**. The data, in whole or in part, may not be sold, licensed, repackaged or otherwise commercialized, or offered through any paid or subscription product. The full conditions and disclaimers are on [the portal](https://geodash.vpd.ca/opendata/); a copy of the disclaimer is in [`data/vpd/`](data/vpd/legal_disclaimer.txt).

This covers `web/data.json`, which is built from that data. VanScene is free, has no ads and no paid features, and must stay that way while it uses VPD data. If you reuse this project, the same terms apply to the data.

## Run it locally

`web/data.json` is already in the repository, so you only need Python to serve the folder:

```
cd web
python -m http.server 8000
```

Then open `http://localhost:8000`. It needs a local server: opening `index.html` directly can't load the data.

### Refresh the data yourself

The weekly Action ([`.github/workflows/update-data.yml`](.github/workflows/update-data.yml)) runs every Sunday at 19:00 UTC: noon in Vancouver in summer, 11 am in winter. It runs again on Tuesdays in case GitHub starts Sunday's run late or skips it, since VPD asks that sites using its data refresh at least every 7 days and show the date (the app shows it under the map key). It downloads every year from 2016 to now, rebuilds `data.json`, and commits it only if something changed. If the run fails, or the new data looks broken, it opens an issue called **Weekly crime data update failed** with a link to the log, and the site keeps the previous data. To run it early, open the **Actions** tab, pick **Update crime data**, and click **Run workflow**. If a run stopped because of a drop of more than 5% in incidents and GeoDASH shows the drop is real, tick **force** before clicking it.

To do the same on your own computer, from the project folder:

```
python scripts/update_data.py
```

It needs only standard Python, with nothing to install. It has three safeguards:

- **No new data:** it leaves `data.json` alone when VPD has nothing new.
- **A big drop:** it refuses to replace the file if the new data has more than 5% fewer incidents, which usually means a broken download. Add `--force` if the drop is real.
- **Bad text:** it stops if a crime type or neighbourhood name contains characters that could become web page markup.

To build from CSVs you downloaded yourself, unzip them into `data/raw/` and run `python scripts/prepare_data.py`. By using the data you agree to VPD's [disclaimer](data/vpd/legal_disclaimer.txt).

## How it's built

A static site with no framework and no build step. It's deployed on Vercel from the `web/` folder.

```
├── README.md
├── .github/workflows/
│   ├── ci.yml            # runs the tests on every pull request
│   └── update-data.yml   # refreshes web/data.json every Sunday, opens an issue if that fails
├── data/
│   ├── raw/              # create locally for VPD CSVs (not in the repo)
│   └── vpd/              # VPD's disclaimer and data description
├── docs/
│   ├── datathon.md             # the problem and data evidence written for the datathon
│   ├── logo/                   # the logo at the top of this page, light and dark
│   ├── vanscene-demo.gif       # the animation at the top of this page, light theme
│   └── vanscene-demo-dark.gif  # the same in the dark theme, shown to readers using GitHub's dark mode
├── scripts/
│   ├── update_data.py    # downloads the latest VPD data, then runs prepare_data.py
│   ├── boundaries.py     # downloads the City's neighbourhood boundaries into web/boundaries.json (run by hand)
│   └── prepare_data.py   # turns the raw CSVs into web/data.json
├── tests/
│   └── test_data.py      # checks the data scripts and web/data.json
└── web/
    ├── index.html        # the page
    ├── styles.css        # the look, light and dark
    ├── app.js            # the map, filters and panels
    ├── data.json         # processed data the app loads
    └── boundaries.json   # City of Vancouver local-area boundaries, to tell which neighbourhood a spot is in
```

### Choices we made, and why

| Choice | Why |
|---|---|
| Plain HTML, CSS and JavaScript, no framework or build step | Easy to run, review and host, and anyone on the team can change it |
| Python standard library only for the data scripts | Teammates and mentors can run them without installing anything |
| Leaflet and Leaflet.heat, over OpenFreeMap vector tiles drawn by MapLibre | Free and open source, with no API keys or accounts; vector tiles let the map take our own colours and labels |
| One fixed colour scale for every year and crime type | The same colour means the same amount everywhere, so years and types can be compared |
| Four equal six-hour parts of the day, compared per hour | Unequal periods made the longest one look busiest just because it was longer |
| Comparing an area with the city average for the same size of circle | A raw count alone says little; busy places will always show more |
| Map zoom capped at about street level, and a 500 m summary circle | VPD offsets locations, so building-level detail would imply precision the data doesn't have |
| Plain-language crime type labels (for example "Theft from cars" instead of "Theft from Vehicle") | Newcomers shouldn't need to learn police categories |
| Points stored column by column in `data.json` | The download is about 45% smaller, which matters most on phones |
| A weekly GitHub Action for the data | The map stays current without anyone remembering to update it |

## Contributing

Open an issue or a pull request against `main`. Keep changes small and focused, run the app locally to check them, run the tests with `python -m unittest discover tests`, and describe what changed and how you tested it in the pull request.

## What's next

- [ ] Add a feedback link and test with newcomers outside the team
- [ ] Check that testers don't read the map as a safety rating
- [x] Add violent-crime counts to neighbourhood summaries (these rows have a neighbourhood but no map location)
- [ ] Explore adjusting counts for population or foot traffic, so busy areas aren't unfairly highlighted
- [ ] Note in the app that SkyTrain incidents are excluded (they're Transit Police jurisdiction)

## Responsible use and disclaimer

- **Not a safety rating.** VanScene shows where incidents were reported. It does not measure how safe an area is or predict future incidents.
- **Reported incidents only.** Many crimes go unreported, and reporting rates differ by crime type and community.
- **Approximate locations.** VPD offsets incident locations for privacy, and exact addresses are never shown. The 500-metre area is an estimate, not a precise boundary.
- **Violent crime isn't on the map.** VPD withholds locations for offences against a person, so the map shows property crime and traffic collisions only. Their counts are shown per neighbourhood instead, which covers a much bigger area than the 500 m circle.
- **Counts, not rates.** Busy areas with more residents, workers, and visitors naturally show more reports. Figures are not adjusted for population or foot traffic.
- **Data limitations.** VPD open data can be delayed, revised, or reclassified. We can't guarantee figures are complete or current.
- **Responsible use.** Don't use VanScene to discriminate against people or communities, or as the sole basis for housing, rental, insurance, or employment decisions.

VanScene is an informational and educational project built for the Build Trilemma Datathon. It is not affiliated with, endorsed by, or operated by the Vancouver Police Department or the City of Vancouver. It is provided "as is," without warranties of any kind.

**Data source:** Vancouver Police Department, [GeoDASH Open Data](https://geodash.vpd.ca/opendata/), for free, non-commercial use only. VPD's own map of incidents: [GeoDASH crime map](https://geodash.vpd.ca/).

**In an emergency, call 911.** VanScene is not an emergency or crime reporting service.

## Credits

VanScene began as **Crimes Against Humanity**'s entry to the Build Trilemma Datathon 2026, built with [Yazid Nasser](https://github.com/YazidNasser), [Hsu-An Lin](https://github.com/githuboy724) and [Parneet Singh](https://github.com/Parneet190). The team's repository is [YazidNasser/VanScene](https://github.com/YazidNasser/VanScene); this one is my own copy and stays in step with it. The problem and data evidence we wrote for the datathon is in [`docs/datathon.md`](docs/datathon.md).
