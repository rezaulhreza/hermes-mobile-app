"""Push notifications for the Hermes phone app, as one package with a fixed module name.

* ``devices``: the phones that asked for notifications (a file in the Hermes home).
* ``sender``: signs a provider token and posts one alert to Apple over HTTP/2.
* ``service``: decides what is worth a notification and hands it to a thread.
* ``hooks``: tells ``service`` when Hermes starts to wait for the user.

Everything is off until ``push.enabled`` is set in ``config.yaml``.
"""

from __future__ import annotations

from . import devices, hooks, sender, service  # noqa: F401
