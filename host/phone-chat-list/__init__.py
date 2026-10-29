"""The phone-chat-list plugin has no hooks. Its routes are in ``dashboard/plugin_api.py``."""


def register(ctx) -> None:  # noqa: ARG001 - the plugin loader calls this
    return None
