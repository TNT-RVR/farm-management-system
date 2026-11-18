# Third-party material

Most of this repository is the project's own work under [LICENSE.md](LICENSE.md).
The items below are other people's, are included or used under their own
terms, and are **not** covered by that licence.

## Canadian Grain Commission moisture charts

`public/919-charts/` holds the Canadian Grain Commission's Model 919 moisture
meter conversion charts, and `src/data/919-charts/` the tables read out of them.

Source: Canadian Grain Commission, <https://www.grainscanada.gc.ca/>. © His
Majesty the King in right of Canada, as represented by the Canadian Grain
Commission. Reproduced for non-commercial use under the Government of Canada's
terms for reproducing its information.

These are reference copies. **They are not official versions** of the charts,
and they have not been made in affiliation with, or with the endorsement of,
the Government of Canada or the Canadian Grain Commission. The charts are
reissued from time to time: before relying on one for a sale or a grade, check
it against the current chart on the Commission's site.

## Alberta Township System survey data

`public/ats-townships.bin` is built (by `scripts/build_ats_townships.py`) from
the Alberta Township System survey data published by the Government of Alberta.

Contains information licensed under the Open Government Licence – Alberta
(<https://open.alberta.ca/licence>).

## Fonts

- **Noto Sans** (`public/fonts/Noto Sans Regular/`, the map labels):
  © The Noto Project Authors, under the SIL Open Font License 1.1. The licence
  is in that folder as `OFL.txt`.
- **Carlito** (`public/fonts/carlito/`): © The Carlito Project Authors, under
  the SIL Open Font License 1.1. The licence is in that folder as `OFL.txt`.

## Satellite imagery

The maps draw Esri World Imagery tiles live from Esri's servers; no imagery is
stored in this repository. The tiles are Esri's and its providers' (Esri,
Maxar, Earthstar Geographics and the GIS User Community), used under
[Esri's terms of use](https://www.esri.com/en-us/legal/terms/full-master-agreement).
Every map shows that credit behind its small "i" button; keep it there if you
change the maps.

## Software packages

The npm packages this app is built with keep their own licences, which ship
with each package in `node_modules/`. None is under the GPL, AGPL or SSPL.
