"""phone-push: notifications for the Hermes phone app when the agent waits for the user.

The code is in ``push/`` and is loaded under ONE module name, so the dashboard routes and this
entry point share one copy (two copies would send every notification twice).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

MODULE = "hermes_phone_push"


def load():
    """The push package, loaded once for the whole process."""
    if MODULE in sys.modules:
        return sys.modules[MODULE]
    root = Path(__file__).resolve().parent / "push"
    spec = importlib.util.spec_from_file_location(MODULE, root / "__init__.py", submodule_search_locations=[str(root)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE] = module
    spec.loader.exec_module(module)
    return module


def register(ctx) -> None:
    push = load()
    push.hooks.install()
    # The gateway may load after the plugins: try again when the first session starts.
    ctx.register_hook("on_session_start", lambda **_kwargs: push.hooks.install())
