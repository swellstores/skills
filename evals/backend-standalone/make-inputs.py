"""Input files for cases 2 and 3: make-inputs.py <prefix> <directory>."""
import csv, json, random, copy, os, sys
def customers(P, d):
    rnd = random.Random(7)
    first = ["Ada","Ben","Cleo","Dev","Eli","Fay","Gus","Hana","Ivo","Jun","Kai","Lena","Milo","Nia","Otto","Pia"]
    last = ["Abbot","Baker","Cole","Dunn","Eads","Frost","Gray","Hale","Ives","Jung","Kerr","Lowe","Moss","Nash","Orr","Pike"]
    cities = [("Austin","TX","73301"),("Boise","ID","83702"),("Denver","CO","80202"),("Miami","FL","33101"),("Portland","OR","97201")]
    rows = []
    for i in range(1, 301):
        c = cities[i % 5]
        rows.append({"email": f"{P}-c{i:03d}@example.com", "first_name": rnd.choice(first), "last_name": rnd.choice(last),
                     "phone": f"555-01{i:04d}", "address1": f"{100+i} Main St", "city": c[0], "state": c[1], "zip": c[2], "country": "US"})
    rows[56]["email"] = "not-an-email"          # row 57
    rows[132]["email"] = ""                     # row 133
    for src, dst in ((10, 201), (20, 202), (30, 203)):   # rows 201-203 repeat rows 10, 20, 30
        rows[dst-1] = dict(rows[src-1], phone=f"555-99{dst:04d}")
    rows2 = copy.deepcopy(rows)
    for r in (5, 6, 7): rows2[r-1]["phone"] = f"555-77{r:04d}"
    rows2[8-1].update(address1="8 New Road", city="Reno", state="NV", zip="89501")
    rows2.append({"email": f"{P}-c301@example.com", "first_name": "Zed", "last_name": "New", "phone": "555-0100301", "address1": "401 Main St", "city": "Austin", "state": "TX", "zip": "73301", "country": "US"})
    for name, rr in (("customers.csv", rows), ("customers-2.csv", rows2)):
        with open(os.path.join(d, name), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rr)
def feeds(P, d):
    def opt(n, sizes, colors, price, base):
        vs = []
        for s in sizes:
            for c in colors:
                vs.append({"sku": f"{P}-p{n:02d}-{s.lower()}-{c.lower()}", "options": {"Size": s, "Color": c},
                           "price": price + (2 if s == "L" else 0), "stock": base + len(vs)})
        return {"sku": f"{P}-p{n:02d}", "name": f"{P} shirt {n}", "price": price, "description": f"Supplier shirt number {n}.",
                "options": [{"name": "Size", "values": sizes}, {"name": "Color", "values": colors}], "variants": vs}
    def simple(n, price, stock):
        return {"sku": f"{P}-p{n:02d}", "name": f"{P} mug {n}", "price": price, "description": f"Supplier mug number {n}.", "stock": stock}
    f1 = [opt(n, ["S","M","L"], ["Red","Blue"], 20 + n, 3 * n) for n in range(1, 7)] + [simple(n, 9 + n, 4 * n) for n in range(7, 11)]
    f2 = copy.deepcopy(f1)
    f2[0] = opt(1, ["S","M"], ["Red","Blue"], 21, 3)                 # p01: size L gone
    f2[1] = opt(2, ["S","M","L"], ["Red","Blue","Green"], 22, 6)     # p02: colour Green added
    f2[2]["price"] = 29; f2[2]["name"] = f"{P} shirt 3 new cut"
    for v in f2[2]["variants"]: v["stock"] += 7; v["price"] += 6     # p03: price, name, stock
    del f2[3]                                                        # p04: gone from the feed
    for p in f2:
        if p["sku"].endswith("p08"): p["stock"] = 0                  # p08: sold out
        if p["sku"].endswith("p09"): p["stock"] = 90                 # p09: restocked
    f2.append(simple(11, 15, 25))                                    # p11: new
    for name, ff in (("feed-1.json", f1), ("feed-2.json", f2)):
        json.dump({"products": ff}, open(os.path.join(d, name), "w"), indent=1)
P, d = sys.argv[1], sys.argv[2]
os.makedirs(d, exist_ok=True)
customers(P, d)
feeds(P, d)
