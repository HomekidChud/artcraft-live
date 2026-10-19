"""Trainer failure/atomic-promotion checks without changing the real checkpoint."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("trainer", Path(__file__).parents[1] / "training/train.py")
trainer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(trainer)


class TrainingTests(unittest.TestCase):
    def test_real_watch_worker_idles_and_rejects_duplicate(self):
        # Use a private temporary checkout, not the checkpoint served by the app.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "training").mkdir()
            script = root / "training/train.py"
            script.write_bytes(Path(trainer.__file__).read_bytes())
            (root / "catalog.json").write_bytes((trainer.ROOT / "catalog.json").read_bytes())
            command = [sys.executable, str(script), "--watch", "--interval", "60"]
            import os
            env = dict(os.environ, OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1")
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
            try:
                # Training finishes before the first idle message; readiness is
                # bounded so a regression cannot hang the suite indefinitely.
                import selectors
                import time
                ready = False
                deadline = time.monotonic() + 20
                selector = selectors.DefaultSelector()
                selector.register(process.stdout, selectors.EVENT_READ)
                output = ""
                while time.monotonic() < deadline:
                    if selector.select(timeout=.2):
                        output += os.read(process.stdout.fileno(), 65536).decode()
                        if "Worker idle;" in output:
                            ready = True
                            break
                    if process.poll() is not None:
                        break
                selector.close()
                self.assertTrue(ready, output)
                duplicate = subprocess.run(command, capture_output=True, text=True, env=env, timeout=5)
                self.assertNotEqual(duplicate.returncode, 0)
                self.assertIn("already running", duplicate.stderr)
                checkpoint = json.loads((root / "model.json").read_text())
                self.assertTrue(checkpoint["accepted"])
                self.assertEqual(checkpoint["epochs"], trainer.DEFAULT_EPOCHS)
            finally:
                process.terminate()
                process.communicate(timeout=5)

    def test_reject_unapproved_example(self):
        with tempfile.TemporaryDirectory() as directory:
            extra = Path(directory) / "extra.jsonl"
            extra.write_text(json.dumps({"head": "intent", "label": "create", "text": "bad", "approved": False}))
            with self.assertRaises(ValueError):
                trainer.datasets(json.loads((trainer.ROOT / "catalog.json").read_text()), extra)

    def test_rejected_candidate_preserves_checkpoint(self):
        original = trainer.ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "catalog.json").write_bytes((original / "catalog.json").read_bytes())
            checkpoint = root / "model.json"
            checkpoint.write_text("known-good")
            # Force every regression prediction to the first label.
            with patch.object(trainer, "ROOT", root), patch.object(trainer, "fit", return_value={}), patch.object(
                trainer, "predict", side_effect=lambda net, texts: [0] * len(texts)
            ), patch("builtins.print"):
                self.assertFalse(trainer.train(root / "absent.jsonl"))
            self.assertEqual(checkpoint.read_text(), "known-good")
            self.assertFalse((root / "model.candidate").exists())


if __name__ == "__main__":
    unittest.main()
