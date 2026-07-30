"""
Standalone schedule generator for Just For Jess.

Parses BUILTIN_SPECIALS out of index.html, reads cards.json, and runs the same
4-pass scheduling algorithm as buildSchedule() in dev.html (Fisher-Yates
shuffle, no recycling into other passes) to produce schedule.json.
"""

import json
import random
import re
from datetime import date, timedelta

BASE_DIR = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
INDEX_HTML = __import__("os").path.join(BASE_DIR, "index.html")
CARDS_JSON = __import__("os").path.join(BASE_DIR, "cards.json")
SCHEDULE_JSON = __import__("os").path.join(BASE_DIR, "schedule.json")

START = date(2026, 7, 1)
NUM_DAYS = 366

DOW_TAGS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
WEEKTYPE_TAGS = ['weekday', 'weekend']


# ─────────────────────────────────────────────────────────
# PARSE BUILTIN_SPECIALS FROM index.html
# ─────────────────────────────────────────────────────────
def parse_builtin_specials(html_path):
    with open(html_path, encoding='utf-8') as f:
        html = f.read()

    m = re.search(r'const BUILTIN_SPECIALS\s*=\s*\[(.*?)\];', html, re.S)
    if not m:
        raise ValueError("Could not find 'const BUILTIN_SPECIALS = [ ... ];' in index.html")

    block = m.group(1)
    entries = re.findall(r'\{([^{}]*)\}', block)

    specials = []
    for entry in entries:
        key_m = re.search(r"key\s*:\s*'([^']+)'", entry)
        from_m = re.search(r"from\s*:\s*'([^']+)'", entry)
        to_m = re.search(r"to\s*:\s*'([^']+)'", entry)
        if not (key_m and from_m and to_m):
            continue
        specials.append({
            'key': key_m.group(1),
            'from': from_m.group(1),
            'to': to_m.group(1),
        })
    return specials


# ─────────────────────────────────────────────────────────
# DATE HELPERS (mirrors specialDates()/mmdd()/dowName() in dev.html)
# ─────────────────────────────────────────────────────────
def special_dates(sp):
    """List of 'MM-DD' strings covered by a special's from/to range, respecting year-wrap."""
    fm, fd = (int(x) for x in sp['from'].split('-'))
    tm, td = (int(x) for x in sp['to'].split('-'))
    cur = date(2000, fm, fd)  # 2000 is a leap year, same trick as the JS version
    end_year = 2001 if fm > tm else 2000
    end = date(end_year, tm, td)
    dates = []
    while cur <= end:
        dates.append(f"{cur.month:02d}-{cur.day:02d}")
        cur += timedelta(days=1)
    return dates


def build_special_map(specials):
    special_map = {}
    for sp in specials:
        for md in special_dates(sp):
            special_map.setdefault(md, []).append(sp['key'])
    return special_map


def dk(d):
    return d.strftime('%Y-%m-%d')


def mmdd(d):
    return f"{d.month:02d}-{d.day:02d}"


def dow_name(d):
    names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    return names[d.weekday()]


def is_weekend(d):
    return d.weekday() >= 5


def fisher_yates(seq):
    a = list(seq)
    for i in range(len(a) - 1, 0, -1):
        j = random.randint(0, i)
        a[i], a[j] = a[j], a[i]
    return a


def all_days():
    return [START + timedelta(days=i) for i in range(NUM_DAYS)]


# ─────────────────────────────────────────────────────────
# SCHEDULER — same 4-pass order as buildSchedule() in dev.html
# ─────────────────────────────────────────────────────────
def build_schedule(cards, special_map):
    sched = {}
    used_ids = set()
    days = all_days()

    # Pass 1 — special dates: one matching card per special-tagged slot.
    # Excess cards for a special tag (more cards than slots) stay unused —
    # they are never handed to Pass 2-4.
    for d in days:
        key = dk(d)
        if key in sched:
            continue
        md = mmdd(d)
        for sp_key in special_map.get(md, []):
            eligible = fisher_yates(
                c for c in cards if c['id'] not in used_ids and sp_key in c['tags']
            )
            if eligible:
                sched[key] = eligible[0]['id']
                used_ids.add(eligible[0]['id'])
                break

    # Pass 2 — day-of-week tagged cards.
    dow_cards = fisher_yates(
        c for c in cards if c['id'] not in used_ids and any(t in DOW_TAGS for t in c['tags'])
    )
    for d in days:
        key = dk(d)
        if key in sched:
            continue
        dow = dow_name(d)
        match = next((c for c in dow_cards if c['id'] not in used_ids and dow in c['tags']), None)
        if match:
            sched[key] = match['id']
            used_ids.add(match['id'])

    # Pass 3 — weekday/weekend tagged cards.
    wk_cards = fisher_yates(
        c for c in cards if c['id'] not in used_ids and any(t in WEEKTYPE_TAGS for t in c['tags'])
    )
    for d in days:
        key = dk(d)
        if key in sched:
            continue
        wd_tag = 'weekend' if is_weekend(d) else 'weekday'
        match = next((c for c in wk_cards if c['id'] not in used_ids and wd_tag in c['tags']), None)
        if match:
            sched[key] = match['id']
            used_ids.add(match['id'])

    # Pass 4 — untagged cards fill any remaining slots.
    any_cards = fisher_yates(
        c for c in cards if c['id'] not in used_ids and not c.get('tags')
    )
    ai = 0
    for d in days:
        key = dk(d)
        if key in sched:
            continue
        if ai < len(any_cards):
            sched[key] = any_cards[ai]['id']
            used_ids.add(any_cards[ai]['id'])
            ai += 1

    # No Pass 5 — leftover cards (e.g. excess special-tagged cards with no
    # matching slot) are intentionally left unassigned. No recycling.

    # Safety dedup — mirrors the app's belt-and-suspenders check.
    seen_ids = set()
    for k in list(sched.keys()):
        if sched[k] in seen_ids:
            del sched[k]
        else:
            seen_ids.add(sched[k])

    return sched


# ─────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────
def print_summary(cards, specials, special_map, sched):
    id_to_card = {c['id']: c for c in cards}
    days = all_days()

    print("Note: custom special dates defined in the app via localStorage are not "
          "included in this schedule. Add them manually to BUILTIN_SPECIALS in "
          "index.html before regenerating.\n")

    filled = len(sched)
    print(f"Slots filled: {filled}/{NUM_DAYS}")

    empty_slots = [dk(d) for d in days if dk(d) not in sched]
    if empty_slots:
        print(f"\nEmpty slots ({len(empty_slots)}):")
        for e in empty_slots:
            print(f"  {e}")
    else:
        print("\nEmpty slots: none")

    used_final = set(sched.values())
    unused = [c for c in cards if c['id'] not in used_final]
    print(f"\nUnused cards ({len(unused)}):")
    for c in unused:
        print(f"  #{c['id']} - {c['name']}")

    print("\nSpecial date verification:")
    for sp in specials:
        for md in special_dates(sp):
            match_day = next((d for d in days if mmdd(d) == md), None)
            if match_day is None:
                print(f"  {sp['key']} - {md}: outside the {NUM_DAYS}-day window")
                continue
            key = dk(match_day)
            cid = sched.get(key)
            if cid is None:
                print(f"  {sp['key']} - {key}: UNASSIGNED")
            else:
                cname = id_to_card.get(cid, {}).get('name', '?')
                print(f"  {sp['key']} - {key}: card #{cid} \"{cname}\"")


def main():
    specials = parse_builtin_specials(INDEX_HTML)
    special_map = build_special_map(specials)

    with open(CARDS_JSON, encoding='utf-8') as f:
        data = json.load(f)
    cards = data['cards']

    sched = build_schedule(cards, special_map)

    sched_sorted = dict(sorted(sched.items()))
    with open(SCHEDULE_JSON, 'w', encoding='utf-8') as f:
        json.dump(sched_sorted, f, indent=2)

    print_summary(cards, specials, special_map, sched)
    print(f"\nWrote {SCHEDULE_JSON}")


if __name__ == '__main__':
    main()
