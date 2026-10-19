"""From-scratch NumPy MLPs. No downloaded models, APIs, or chat collection."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EPOCHS = 1000


def tokens(text):
    return re.findall(r"[a-z0-9]+", text.lower())


def features(texts, vocab):
    lookup = {word: i for i, word in enumerate(vocab)}
    result = np.zeros((len(texts), len(vocab)), dtype=np.float64)
    for row, text in enumerate(texts):
        for word in tokens(text):
            if word in lookup:
                result[row, lookup[word]] += 1
        norm = np.linalg.norm(result[row])
        if norm:
            result[row] /= norm
    return result


def predict(net, texts):
    x = features(texts, net["vocab"])
    return np.argmax(np.tanh(x @ net["w1"] + net["b1"]) @ net["w2"] + net["b2"], axis=1)


def fit(rows, labels, seed, epochs=DEFAULT_EPOCHS):
    rng = np.random.default_rng(seed)
    vocab = sorted(set(word for text, _ in rows for word in tokens(text)))
    x = features([text for text, _ in rows], vocab)
    y = np.array([labels.index(label) for _, label in rows])
    # Tanh hidden layer; softmax cross-entropy; manual backpropagation and Adam.
    params = [rng.normal(0, .12, (len(vocab), 40)), np.zeros(40),
              rng.normal(0, .12, (40, len(labels))), np.zeros(len(labels))]
    means = [np.zeros_like(p) for p in params]
    variances = [np.zeros_like(p) for p in params]
    for step in range(1, epochs + 1):
        w1, b1, w2, b2 = params
        h = np.tanh(x @ w1 + b1)
        z = h @ w2 + b2
        probs = np.exp(z - z.max(axis=1, keepdims=True))
        probs /= probs.sum(axis=1, keepdims=True)
        probs[np.arange(len(y)), y] -= 1
        probs /= len(y)
        dh = (probs @ w2.T) * (1 - h * h)
        grads = [x.T @ dh + .0001 * w1, dh.sum(axis=0),
                 h.T @ probs + .0001 * w2, probs.sum(axis=0)]
        for i, grad in enumerate(grads):
            means[i] = .9 * means[i] + .1 * grad
            variances[i] = .999 * variances[i] + .001 * grad * grad
            params[i] -= .015 * (means[i] / (1 - .9**step)) / (
                np.sqrt(variances[i] / (1 - .999**step)) + 1e-8)
    return dict(vocab=vocab, labels=labels,
                **{key: value.round(7).tolist() for key, value in zip(
                    ["w1", "b1", "w2", "b2"], params)})


def datasets(catalog, extra_path):
    craft_rows, craft_checks, intent_rows, intent_checks = [], [], [], []
    for craft in catalog["crafts"]:
        for phrase in [craft["name"], *craft["topic"].split()]:
            for prefix in ["", "help with ", "I am using "]:
                craft_rows.append((prefix + phrase, craft["id"]))
        craft_rows.extend((phrase, craft["id"]) for phrase in craft.get("examples", []))
        craft_checks.extend([(f"I need {craft['name']} advice", craft["id"]),
                             (f"working in {craft['topic'].split()[0]}", craft["id"]),
                             *((phrase, craft["id"]) for phrase in craft.get("checks", []))])
    for intent in catalog["intents"]:
        intent_rows.extend((s, intent["id"]) for s in intent["examples"])
        intent_checks.extend((s, intent["id"]) for s in intent["checks"])
    if extra_path.exists():
        for line in extra_path.read_text().splitlines():
            item = json.loads(line)
            if item.get("approved") is not True:
                raise ValueError("Every additional example must be explicitly approved.")
            head = item["head"]
            label = item["label"]
            allowed = [c["id"] for c in catalog["crafts" if head == "craft" else "intents"]]
            if head not in ("craft", "intent") or label not in allowed:
                raise ValueError("Invalid training head or label.")
            text = item["text"]
            if not isinstance(text, str) or not 1 <= len(text) <= 2000:
                raise ValueError("Training text must contain 1-2000 characters.")
            (craft_rows if head == "craft" else intent_rows).append((text, label))
    return craft_rows, craft_checks, intent_rows, intent_checks


def train(extra_path, seed=42, epochs=DEFAULT_EPOCHS):
    if not isinstance(epochs, int) or epochs < 1:
        raise ValueError("Epochs must be a positive integer.")
    catalog = json.loads((ROOT / "catalog.json").read_text())
    cr, cc, ir, ic = datasets(catalog, extra_path)
    nets, report = {}, {}
    for name, rows, checks, labels in [
        ("craft", cr, cc, [c["id"] for c in catalog["crafts"]]),
        ("intent", ir, ic, [i["id"] for i in catalog["intents"]]),
    ]:
        net = fit(rows, labels, seed, epochs)
        actual = predict(net, [text for text, _ in checks])
        passes = [labels[p] == label for p, (_, label) in zip(actual, checks)]
        per_label = {label: all(ok for ok, (_, expected) in zip(passes, checks)
                               if expected == label) for label in labels}
        report[name] = {"correct": sum(passes), "total": len(checks),
                        "accuracy": sum(passes) / len(checks), "per_label_pass": per_label,
                        "training_examples": len(rows)}
        report[name]["failures"] = [
            {"text": text, "expected": label, "predicted": labels[p]}
            for p, (text, label), ok in zip(actual, checks, passes) if not ok]
        nets[name] = net
    # Every label must pass its smoke checks, not just the aggregate.
    accepted = all(all(r["per_label_pass"].values()) for r in report.values())
    document = {"schema": 1, "architecture": "bag-of-words / tanh MLP / softmax",
                "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "seed": seed, "epochs": epochs, "accepted": accepted,
                "catalog_sha256": hashlib.sha256((ROOT / "catalog.json").read_bytes()).hexdigest(),
                "evaluation_scope": "Small curated routing smoke test, not general chat/task competence.",
                "metrics": report, "networks": nets}
    if accepted:
        # Atomic replacement: readers never observe a half-written checkpoint.
        path = ROOT / "model.json"
        temp = path.with_suffix(".candidate")
        temp.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        os.replace(temp, path)
    print(json.dumps({"accepted": accepted, "metrics": report}, indent=2), flush=True)
    return accepted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true", help="Check for reviewed data changes; sleep when unchanged.")
    parser.add_argument("--interval", type=int, default=3600)
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS,
                        help=f"Full-dataset training epochs (default: {DEFAULT_EPOCHS}).")
    parser.add_argument("--extra", type=Path, default=ROOT / "training/local-approved.jsonl")
    args = parser.parse_args()
    if args.interval < 60:
        parser.error("Minimum interval is 60 seconds.")
    if args.epochs < 1:
        parser.error("Epochs must be a positive integer.")
    if not args.watch:
        raise SystemExit(0 if train(args.extra, epochs=args.epochs) else 1)
    import fcntl
    lock = (ROOT / "training/.worker.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("A training worker is already running.")
    previous = None
    while True:
        try:
            digest = hashlib.sha256((ROOT / "catalog.json").read_bytes() +
                                    (args.extra.read_bytes() if args.extra.exists() else b"")).hexdigest()
            if digest != previous:
                # Rejected candidates are not retried without new data.
                train(args.extra, epochs=args.epochs)
                previous = digest
            print(f"Worker idle; next reviewed-data check in {args.interval}s", flush=True)
        except (ValueError, OSError, KeyError) as error:
            print(f"Training failed; preserving current model: {error}", flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
