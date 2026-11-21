"""Redis cache with graceful fallback (app keeps working if Redis is down)."""
import json
import time
import redis
from flask import current_app

_client = None
_down_until = 0


def _r():
    global _client, _down_until
    if time.time() < _down_until:
        return None
    if _client is None:
        _client = redis.Redis.from_url(current_app.config["REDIS_URL"], decode_responses=True,
                                       socket_connect_timeout=0.3, socket_timeout=0.3)
    return _client


def _fail():
    global _down_until
    _down_until = time.time() + 30  # skip Redis for 30s after a failure


def cached(key, fn, ttl=None):
    """Return cached JSON for key, else compute with fn(), store with expiry."""
    key = "emp:" + key
    r = _r()
    if r:
        try:
            hit = r.get(key)
            if hit is not None:
                return json.loads(hit)
        except Exception:
            _fail(); r = None
    val = fn()
    if r:
        try:
            r.setex(key, ttl or current_app.config["CACHE_TTL"], json.dumps(val))
        except Exception:
            _fail()
    return val


def invalidate(*prefixes):
    r = _r()
    if not r:
        return
    try:
        for p in prefixes:
            for k in r.scan_iter("emp:" + p + "*"):
                r.delete(k)
    except Exception:
        _fail()
