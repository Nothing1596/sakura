"""Read-only deployment gate. Compare the live directory before preparing replacement."""

import hashlib, json, sys
from pathlib import Path

expected = json.loads(Path(__file__).with_name("baseline.json").read_text())["files"]
root = Path(sys.argv[1])
mismatch = []
for name, digest in expected.items():
    path = root / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        mismatch.append(name)
if mismatch:
    raise SystemExit("BASELINE_CHANGED: " + ",".join(mismatch))
print("BASELINE_MATCHED")
