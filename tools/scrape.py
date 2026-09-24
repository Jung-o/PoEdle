"""Scrape the poedb / poe2db unique item lists into data/<game>/ + img/<game>/.

Only the Weapon / Armour / Other tabs are parsed (PoE 1 "Unique Item Recipe" and
"Foulborn Uniques", PoE 2 "Cultivated Uniques" are skipped). The listing only shows
the base type ("Driftwood Wand"), so the item class ("Wand") comes from RePoE's
base_items.json, an export of the game data.

Usage:  python tools/scrape.py poe1                     (re-run after a league update)
        python tools/scrape.py poe2 --no-images
        python tools/scrape.py poe1 --page saved.html   (parse a locally saved copy)

Items listed in tools/excluded-<game>.json (by item type or name) are left out.
"""
import argparse
import copy
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote

import requests
from lxml import html

ROOT = Path(__file__).resolve().parent.parent
TABS = {"WeaponUnique": "Weapon", "ArmourUnique": "Armour", "OtherUnique": "Other"}

GAMES = {
    "poe1": {
        "site": "https://poedb.tw",
        "cdn": "https://cdn.poedb.tw/image/Art/2DItems/",
        "base_items": "https://repoe-fork.github.io/base_items.json",
        # Game-internal item class -> friendly label shown in the game.
        "class_names": {
            "UtilityFlask": "Flask", "ManaFlask": "Flask", "LifeFlask": "Flask", "HybridFlask": "Flask",
            "AbyssJewel": "Abyss Jewel",
            "AtlasRelic": "Idol",
            "Relic": "Sanctum Relic",
            "MapKey": "Map",
            "UniqueFragment": "Map Fragment",
            "HeistContract": "Contract",
            "FishingRod": "Fishing Rod",
        },
    },
    "poe2": {
        "site": "https://poe2db.tw",
        "cdn": "https://cdn.poe2db.tw/image/Art/2DItems/",
        "base_items": "https://repoe-fork.github.io/poe2/base_items.json",
        "class_names": {
            "UtilityFlask": "Charm", "ManaFlask": "Flask", "LifeFlask": "Flask",
            "TowerAugmentation": "Tablet",
            "Relic": "Sanctum Relic",
            "Warstaff": "Quarterstaff",
        },
    },
}


def headers(cfg):
    # The image CDN rejects some requests without a Referer from the site.
    return {"User-Agent": "Mozilla/5.0 (PoEdle data scraper)", "Referer": cfg["site"] + "/"}


def clean(text):
    text = text.replace("\xa0", " ").replace("–", "-").replace("—", "-")
    text = re.sub(r"[ \t]+", " ", text)
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def mod_text(div):
    """Return (mod, reminders) for an implicitMod/explicitMod div."""
    div = copy.deepcopy(div)
    for el in div.xpath('.//span[contains(@class,"secondary")]'):  # hidden stat ids
        el.drop_tree()
    reminders = []
    for el in div.xpath('.//span[contains(@class,"item_description")]'):
        reminders.append(clean(el.text_content()))
        el.drop_tree()
    for br in div.xpath(".//br"):
        br.tail = "\n" + (br.tail or "")
    return clean(div.text_content()), [r for r in reminders if r]


def local_image_path(game, cfg, src):
    """img/<game>/<path under 2DItems>, with a URL-safe file name ("Ahn%20Artifact" -> "Ahn_Artifact")."""
    if not src.startswith(cfg["cdn"]):
        return src
    return f"img/{game}/" + re.sub(r"[^A-Za-z0-9._/-]", "_", unquote(src[len(cfg["cdn"]):]))


def parse_requirements(text):
    req = {}
    m = re.search(r"Level\s+(\d+)", text)
    if m:
        req["level"] = int(m.group(1))
    for n, attr in re.findall(r"(\d+)\s+(Str|Dex|Int)", text):
        req[attr.lower()] = int(n)
    return req


def expected_count(tab):
    """The tab header reads e.g. "Weapon Unique /286"."""
    header = tab.xpath('.//h5[contains(@class,"card-header")]')
    m = re.search(r"/(\d+)", header[0].text_content()) if header else None
    return int(m.group(1)) if m else None


def parse(game, cfg, page, base_classes):
    doc = html.fromstring(page)
    items = []
    for tab_id, category in TABS.items():
        tab = doc.get_element_by_id(tab_id, None)
        if tab is None:
            raise ValueError(f"tab #{tab_id} not found (truncated page?)")
        before = len(items)
        for block in tab.xpath('.//div[contains(@class,"d-flex") and contains(@class,"border-top")]'):
            name = clean(block.xpath('.//span[@class="uniqueName"]')[0].text_content())
            base = clean(block.xpath('.//span[@class="uniqueTypeLine"]')[0].text_content())
            # Only the art column: mods can contain skill icons (<img class="grantsSkill">).
            img_src = block.xpath('./div[contains(@class,"flex-shrink-0")]//img/@src')[0]
            href = block.xpath('.//span[@class="uniqueName"]/ancestor::a[1]/@href')[0]
            body = block.xpath('./div[contains(@class,"flex-grow-1")]')[0]

            raw_class = base_classes.get(base)
            if raw_class is None:
                print(f"  ! unknown base type {base!r} for {name}", file=sys.stderr)
            item = {
                "name": name,
                "base": base,
                "category": category,
                "type": cfg["class_names"].get(raw_class, raw_class or "Unknown"),
                "requirements": {},
                "implicits": [],
                "explicits": [],
                "reminders": [],
                "corrupted": False,
                "image": local_image_path(game, cfg, img_src),
                "imageUrl": img_src,
                "url": cfg["site"] + href if href.startswith("/") else href,
            }
            for div in body.xpath("./div"):
                cls = div.get("class", "")
                if cls == "requirements":
                    item["requirements"] = parse_requirements(div.text_content())
                elif cls in ("implicitMod", "explicitMod"):
                    text, reminders = mod_text(div)
                    item["reminders"] += reminders
                    if text:
                        item["implicits" if cls == "implicitMod" else "explicits"].append(text)
                elif cls == "corrupted":
                    item["corrupted"] = True
            items.append(item)
        found, expected = len(items) - before, expected_count(tab)
        print(f"{category}: {found} items (header says {expected})")
        if expected is not None and found != expected:
            raise ValueError(f"{category}: parsed {found} items, expected {expected} (truncated page?)")
    return items


def fetch_page(game, cfg, base_classes):
    """Download and parse the listing, retrying: the site sometimes times out or truncates."""
    for attempt in range(1, 5):
        try:
            page = requests.get(cfg["site"] + "/us/Unique_item", headers=headers(cfg), timeout=120).content
            return parse(game, cfg, page, base_classes)
        except (requests.RequestException, ValueError) as e:
            print(f"  ! attempt {attempt} failed: {e}", file=sys.stderr)
            time.sleep(10 * attempt)
    sys.exit("Could not fetch a complete page. Save it from a browser and use --page FILE.")


def download_images(cfg, items):
    session = requests.Session()
    session.headers.update(headers(cfg))
    todo = {i["image"]: i["imageUrl"] for i in items if i["image"].startswith("img/")}
    todo = {p: u for p, u in todo.items() if not (ROOT / p).exists()}
    print(f"Downloading {len(todo)} images...")

    def fetch(entry):
        path, url = entry
        for attempt in range(3):
            try:
                r = session.get(url, timeout=30)
                r.raise_for_status()
                dest = ROOT / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(r.content)
                return None
            except requests.RequestException as e:
                err = e
                time.sleep(1 + attempt)
        return f"{url}: {err}"

    with ThreadPoolExecutor(max_workers=2) as pool:
        errors = [e for e in pool.map(fetch, todo.items()) if e]
    for e in errors:
        print("  ! " + e, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("game", choices=GAMES)
    parser.add_argument("--page", help="parse a locally saved copy of the unique list")
    parser.add_argument("--no-images", action="store_true")
    args = parser.parse_args()
    cfg = GAMES[args.game]

    print("Fetching base items (RePoE)...")
    base_items = requests.get(cfg["base_items"], headers=headers(cfg), timeout=60).json()
    base_classes = {v["name"]: v["item_class"] for v in base_items.values()}

    if args.page:
        print(f"Parsing {args.page}...")
        items = parse(args.game, cfg, Path(args.page).read_bytes(), base_classes)
    else:
        print(f"Fetching {cfg['site']} unique list...")
        items = fetch_page(args.game, cfg, base_classes)

    excluded = json.loads((ROOT / "tools" / f"excluded-{args.game}.json").read_text(encoding="utf-8"))
    kept = [i for i in items if i["type"] not in excluded["types"] and i["name"] not in excluded["names"]]
    print(f"Excluded {len(items) - len(kept)} items (tools/excluded-{args.game}.json)")
    items = kept

    if not args.no_images:
        download_images(cfg, items)
    for i in items:
        del i["imageUrl"]

    out = ROOT / "data" / args.game
    out.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(items, ensure_ascii=False, indent=1)
    (out / "uniques.json").write_text(payload, encoding="utf-8")
    (out / "uniques.js").write_text(
        f"// Generated by tools/scrape.py on {time.strftime('%Y-%m-%d')} from {cfg['site']}/us/Unique_item\n"
        f"(window.POEDLE_DATA = window.POEDLE_DATA || {{}})[{json.dumps(args.game)}] = {payload};\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(items)} uniques to data/{args.game}/")


if __name__ == "__main__":
    main()
