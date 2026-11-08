"""WhatsApp providers. The engine composes and logs; a provider only moves text in and out.

Contract (any provider):
  number() -> str            the E.164 digits this provider can reach, or "" for any number
  send(phone, text) -> str   the provider's message id; raises ProviderError with the provider's own words
  inbox(after) -> list       new inbound entries after a cursor: {seq, phone, text, kind: "text" | "voice", media_path, media_mimetype}
  cursor() -> int            the newest cursor now, so a conversation only reads replies sent after it opened
"""
import json
import os
import urllib.error
import urllib.request


class ProviderError(RuntimeError):
    pass


def digits(phone: str) -> str:
    return "".join(c for c in str(phone or "") if c.isdigit())


class BridgeProvider:
    """The WhatsApp bridge on the mini (127.0.0.1:8013): pinned to one number, which is Xander's for the demo."""

    def __init__(self, base: str | None = None, pinned: str | None = None):
        self.base = (base or os.environ.get("WA_BRIDGE_URL") or "http://127.0.0.1:8013").rstrip("/")
        self.pinned = digits(pinned or os.environ.get("WA_BRIDGE_TO") or "")  # the bridge's pinned number, from env only

    def number(self) -> str:
        return self.pinned

    def _call(self, method: str, path: str, body: dict | None = None, timeout: float = 15):
        req = urllib.request.Request(self.base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            try:
                msg = json.load(e).get("error") or f"bridge answered {e.code}"
            except Exception:
                msg = f"bridge answered {e.code}"
            raise ProviderError(f"WhatsApp bridge: {msg}")
        except Exception as e:
            raise ProviderError(f"WhatsApp bridge unreachable at {self.base}: {e}")

    def send(self, phone: str, text: str) -> str:
        if not self.pinned:
            raise ProviderError("WA_BRIDGE_TO is not set on this engine, so the WhatsApp line has no number it may reach.")
        if digits(phone) != self.pinned:
            raise ProviderError("The WhatsApp bridge can only reach its own pinned number; this lead's phone is a different number.")
        return self._call("POST", "/send", {"text": text}).get("id") or ""

    def _page(self, after: int) -> list:
        return self._call("GET", f"/inbox?after={int(after)}&limit=50", timeout=8).get("entries") or []

    def inbox(self, after: int) -> list:
        out = []
        for e in self._page(after):  # the bridge's inbox holds only the pinned number's direct messages
            voice = bool(e.get("media_path")) and str(e.get("media_mimetype") or "").startswith("audio")
            out.append({"seq": int(e["seq"]), "phone": self.pinned, "text": e.get("text") or "", "kind": "voice" if voice else "text",
                        "media_path": e.get("media_path"), "media_mimetype": e.get("media_mimetype"), "media_status": e.get("media_status"),
                        "msg_id": e.get("msg_id")})
        return out

    def cursor(self) -> int:
        seq = 0
        while True:
            page = self._page(seq)
            if not page:
                return seq
            seq = max(int(e["seq"]) for e in page)
            if len(page) < 50:
                return seq


class CloudApiProvider:
    """WhatsApp Business Cloud API (Meta), so any installer's own number can be plugged in. Not wired yet: it needs the
    installer's phone number id, an access token and a webhook for replies (inbound arrives by webhook, not by polling)."""

    def __init__(self, phone_number_id: str | None = None, token: str | None = None):
        self.phone_number_id = phone_number_id or os.environ.get("WA_CLOUD_PHONE_NUMBER_ID")
        self.token = token or os.environ.get("WA_CLOUD_TOKEN")

    def number(self) -> str:
        return ""

    def send(self, phone: str, text: str) -> str:
        # POST https://graph.facebook.com/v21.0/{phone_number_id}/messages {messaging_product: "whatsapp", to, type: "text", text: {body}}
        raise ProviderError("The WhatsApp Cloud API provider is not configured on this engine.")

    def inbox(self, after: int) -> list:
        return []

    def cursor(self) -> int:
        return 0


def get() -> BridgeProvider | CloudApiProvider:
    return CloudApiProvider() if os.environ.get("WA_PROVIDER") == "cloud" else BridgeProvider()
