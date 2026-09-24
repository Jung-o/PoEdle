# PoEdle

Path of Exile guessing games. Pure HTML/CSS/JS, no build step.

## Minigames

- **PoE 1 Uniques** / **PoE 2 Uniques**: a random unique is chosen; each guess is compared on
  Category, Item type, Implicit affixes and Explicit affixes
  (green = exact, orange = some affixes shared, red = nothing in common).
  Affixes are compared ignoring roll values, so `(20-28)% increased Spell Damage`
  matches `15% increased Spell Damage`.

## Run locally

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8765
```

## Host on GitHub Pages

Push this folder to a repository, then *Settings > Pages > Deploy from a branch*
and pick the branch and `/ (root)`.

## Updating the item data

`tools/scrape.py` parses https://poedb.tw/us/Unique_item (PoE 1) or
https://poe2db.tw/us/Unique_item (PoE 2): Weapon, Armour and Other tabs only (recipes,
Foulborn and Cultivated uniques are skipped). It maps each base type to its item class
using [RePoE](https://repoe-fork.github.io/) `base_items.json`, downloads the art to
`img/<game>/` and writes `data/<game>/uniques.js` (loaded by the page) and `uniques.json`.

```bash
pip install requests lxml
python tools/scrape.py poe1
python tools/scrape.py poe2
```

Items listed in `tools/excluded-<game>.json` (by item type or by name) are left out.

## Adding a minigame

Create `js/games/<name>.js` that calls
`PoEdle.register({ id, name, mount(container) })`, and add a `<script>` tag for it in
`index.html`. It will appear in the nav and be reachable at `#<id>`.
