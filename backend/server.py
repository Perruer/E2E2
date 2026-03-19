"""
XAMTON Backend Server (SQLite)
Relay-нода: signaling, store-and-forward, WebSocket realtime

Без внешних зависимостей для БД — SQLite встроен в Python.
"""

from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import secrets
import base64
import time
import sqlite3
import threading
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timedelta, timezone
import json
from collections import defaultdict

# ============ App Setup ============

app = FastAPI(title="XAMTON Relay", version="2.0.0")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# ============ SQLite Setup ============

DB_PATH = os.environ.get("XAMTON_DB_PATH", "xamton.db")

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

_local = threading.local()

def db() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = get_db()
    return _local.conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            display_name TEXT,
            identity_key TEXT NOT NULL,
            signing_key TEXT,
            online INTEGER DEFAULT 0,
            last_seen TEXT,
            created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS prekey_bundles (
            user_id TEXT PRIMARY KEY,
            identity_key TEXT NOT NULL,
            signed_prekey_id INTEGER NOT NULL,
            signed_prekey TEXT NOT NULL,
            signed_prekey_signature TEXT NOT NULL,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS one_time_prekeys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            key_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT,
            used_at TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL,
            recipient_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            signature TEXT DEFAULT '',
            delivered INTEGER DEFAULT 0,
            timestamp TEXT NOT NULL,
            stored_at TEXT,
            delivered_at TEXT,
            expires_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, delivered);
        CREATE INDEX IF NOT EXISTS idx_otpk_user ON one_time_prekeys(user_id, used);
    """)
    conn.commit()
    conn.close()
    logger.info(f"Database initialized: {DB_PATH}")

# ============ Rate Limiter ============

class RateLimiter:
    def __init__(self, max_tokens: int = 10, refill_rate: float = 1.0):
        self.max_tokens = max_tokens
        self.refill_rate = refill_rate
        self.buckets: Dict[str, dict] = defaultdict(lambda: {"tokens": max_tokens, "last": time.time()})

    def allow(self, key: str) -> bool:
        bucket = self.buckets[key]
        now = time.time()
        elapsed = now - bucket["last"]
        bucket["tokens"] = min(self.max_tokens, bucket["tokens"] + elapsed * self.refill_rate)
        bucket["last"] = now
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True
        return False

message_limiter = RateLimiter(max_tokens=10, refill_rate=1.0)
register_limiter = RateLimiter(max_tokens=5, refill_rate=0.1)

# ============ Models ============

class UserRegistration(BaseModel):
    user_id: str
    display_name: Optional[str] = None
    identity_key: str
    signing_key: Optional[str] = None

class PreKeyBundleCreate(BaseModel):
    user_id: str
    identity_key: str
    signed_prekey_id: int
    signed_prekey: str
    signed_prekey_signature: str
    one_time_prekeys: List[dict] = []

class EncryptedMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sender_id: str
    recipient_id: str
    payload: str
    signature: str = ""
    ttl_hours: int = 72

# ============ WebSocket Manager ============

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def send_personal_message(self, user_id: str, message: dict) -> bool:
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
                return True
            except:
                self.disconnect(user_id)
        return False

    def disconnect(self, user_id: str):
        self.active_connections.pop(user_id, None)

    def get_online_users(self) -> List[str]:
        return list(self.active_connections.keys())

    def is_online(self, user_id: str) -> bool:
        return user_id in self.active_connections

manager = ConnectionManager()

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ============ API Endpoints ============

@api_router.get("/")
async def root():
    return {"name": "XAMTON Relay", "version": "2.0.0", "status": "operational"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": now_iso()}

# ---- Users ----

@api_router.post("/users/register")
async def register_user(user: UserRegistration):
    if not register_limiter.allow(user.user_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    conn = db()
    existing = conn.execute("SELECT user_id FROM users WHERE user_id=?", (user.user_id,)).fetchone()

    if existing:
        conn.execute(
            "UPDATE users SET display_name=?, identity_key=?, signing_key=COALESCE(?,signing_key), last_seen=? WHERE user_id=?",
            (user.display_name, user.identity_key, user.signing_key, now_iso(), user.user_id),
        )
    else:
        conn.execute(
            "INSERT INTO users (user_id, display_name, identity_key, signing_key, last_seen, created_at) VALUES (?,?,?,?,?,?)",
            (user.user_id, user.display_name, user.identity_key, user.signing_key, now_iso(), now_iso()),
        )
    conn.commit()
    return {"success": True, "user_id": user.user_id}

@api_router.get("/users/{user_id}")
async def get_user(user_id: str):
    row = db().execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user_id": row["user_id"],
        "display_name": row["display_name"],
        "identity_key": row["identity_key"],
        "last_seen": row["last_seen"],
    }

# ---- PreKey Bundles ----

@api_router.post("/prekeys")
async def upload_prekey_bundle(bundle: PreKeyBundleCreate):
    conn = db()
    conn.execute(
        """INSERT OR REPLACE INTO prekey_bundles
           (user_id, identity_key, signed_prekey_id, signed_prekey, signed_prekey_signature, updated_at)
           VALUES (?,?,?,?,?,?)""",
        (bundle.user_id, bundle.identity_key, bundle.signed_prekey_id,
         bundle.signed_prekey, bundle.signed_prekey_signature, now_iso()),
    )
    for otpk in bundle.one_time_prekeys:
        conn.execute(
            "INSERT INTO one_time_prekeys (user_id, key_id, key, created_at) VALUES (?,?,?,?)",
            (bundle.user_id, otpk["id"], otpk["key"], now_iso()),
        )
    conn.commit()
    return {"success": True, "user_id": bundle.user_id}

@api_router.get("/prekeys/{user_id}")
async def get_prekey_bundle(user_id: str):
    conn = db()
    bundle = conn.execute("SELECT * FROM prekey_bundles WHERE user_id=?", (user_id,)).fetchone()
    if not bundle:
        raise HTTPException(status_code=404, detail="PreKey bundle not found")

    otpk = conn.execute(
        "SELECT * FROM one_time_prekeys WHERE user_id=? AND used=0 LIMIT 1", (user_id,)
    ).fetchone()

    if otpk:
        conn.execute("UPDATE one_time_prekeys SET used=1, used_at=? WHERE id=?", (now_iso(), otpk["id"]))
        conn.commit()

    return {
        "user_id": bundle["user_id"],
        "identity_key": bundle["identity_key"],
        "signed_prekey_id": bundle["signed_prekey_id"],
        "signed_prekey": bundle["signed_prekey"],
        "signed_prekey_signature": bundle["signed_prekey_signature"],
        "one_time_prekey_id": otpk["key_id"] if otpk else None,
        "one_time_prekey": otpk["key"] if otpk else None,
    }

# ---- Messages ----

@api_router.post("/messages")
async def store_message(message: EncryptedMessage):
    if not message_limiter.allow(message.sender_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    now = now_iso()
    expires = (datetime.now(timezone.utc) + timedelta(hours=message.ttl_hours)).isoformat()

    conn = db()
    conn.execute(
        """INSERT INTO messages (id, sender_id, recipient_id, payload, signature, delivered, timestamp, stored_at, expires_at)
           VALUES (?,?,?,?,?,0,?,?,?)""",
        (message.id, message.sender_id, message.recipient_id, message.payload,
         message.signature, now, now, expires),
    )
    conn.commit()

    if manager.is_online(message.recipient_id):
        delivered = await manager.send_personal_message(message.recipient_id, {
            "type": "new_message",
            "message": {"id": message.id, "sender_id": message.sender_id, "payload": message.payload, "timestamp": now}
        })
        if delivered:
            conn.execute("UPDATE messages SET delivered=1, delivered_at=? WHERE id=?", (now, message.id))
            conn.commit()

    return {"success": True, "message_id": message.id}

@api_router.get("/messages/{user_id}")
async def get_pending_messages(user_id: str):
    now = now_iso()
    conn = db()
    rows = conn.execute(
        "SELECT * FROM messages WHERE recipient_id=? AND delivered=0 AND expires_at>? LIMIT 100",
        (user_id, now),
    ).fetchall()

    messages = [dict(r) for r in rows]
    ids = [m["id"] for m in messages]

    if ids:
        placeholders = ",".join(["?"] * len(ids))
        conn.execute(f"UPDATE messages SET delivered=1, delivered_at=? WHERE id IN ({placeholders})", [now] + ids)
        conn.commit()

    return {"messages": messages, "count": len(messages)}

@api_router.delete("/messages/{message_id}")
async def delete_message(message_id: str):
    conn = db()
    cur = conn.execute("DELETE FROM messages WHERE id=?", (message_id,))
    conn.commit()
    return {"success": cur.rowcount > 0}

# ---- Stats ----

@api_router.get("/stats")
async def get_stats():
    conn = db()
    return {
        "total_users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        "total_messages": conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0],
        "pending_messages": conn.execute("SELECT COUNT(*) FROM messages WHERE delivered=0").fetchone()[0],
        "online_users": len(manager.get_online_users()),
        "timestamp": now_iso(),
    }

# ============ WebSocket ============

async def authenticate_websocket(websocket: WebSocket, user_id: str) -> bool:
    try:
        row = db().execute("SELECT signing_key FROM users WHERE user_id=?", (user_id,)).fetchone()
        if not row or not row["signing_key"]:
            logger.warning(f"WS auth: {user_id[:20]}... no signing_key — allowing (legacy)")
            return True

        challenge = secrets.token_bytes(32)
        await websocket.send_json({
            "type": "auth_challenge",
            "challenge": base64.b64encode(challenge).decode(),
        })

        response = await websocket.receive_json()
        if response.get("type") != "auth_response":
            return False

        sig_b64 = response.get("signature", "")
        if not sig_b64:
            return True

        try:
            signature = base64.b64decode(sig_b64)
            signing_key = base64.b64decode(row["signing_key"])
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
            pk = Ed25519PublicKey.from_public_bytes(signing_key)
            pk.verify(signature, challenge)
            return True
        except Exception:
            logger.warning(f"WS auth FAILED for {user_id[:20]}...")
            return False

    except Exception as e:
        logger.error(f"WS auth error: {e}")
        return False

@api_router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await websocket.accept()

    authenticated = await authenticate_websocket(websocket, user_id)
    if not authenticated:
        await websocket.send_json({"type": "auth_failed", "error": "Authentication failed"})
        await websocket.close(code=4001)
        return

    await websocket.send_json({"type": "auth_success"})
    manager.active_connections[user_id] = websocket
    logger.info(f"WS connected: {user_id[:20]}...")

    # Deliver pending
    conn = db()
    now = now_iso()
    rows = conn.execute(
        "SELECT * FROM messages WHERE recipient_id=? AND delivered=0 AND expires_at>?", (user_id, now)
    ).fetchall()
    for msg in rows:
        await websocket.send_json({
            "type": "pending_message",
            "message": {"id": msg["id"], "sender_id": msg["sender_id"], "payload": msg["payload"], "timestamp": msg["timestamp"]}
        })
        conn.execute("UPDATE messages SET delivered=1, delivered_at=? WHERE id=?", (now, msg["id"]))
    conn.commit()

    conn.execute("UPDATE users SET last_seen=?, online=1 WHERE user_id=?", (now, user_id))
    conn.commit()

    try:
        while True:
            data = await websocket.receive_json()

            if data["type"] == "message":
                if not message_limiter.allow(user_id):
                    await websocket.send_json({"type": "error", "error": "Rate limit exceeded"})
                    continue

                recipient_id = data.get("recipient_id")
                if recipient_id:
                    msg_id = str(uuid.uuid4())
                    now2 = now_iso()
                    expires = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()

                    delivered = await manager.send_personal_message(recipient_id, {
                        "type": "new_message",
                        "message": {"id": msg_id, "sender_id": user_id, "payload": data.get("payload"), "timestamp": now2}
                    })

                    conn.execute(
                        """INSERT INTO messages (id,sender_id,recipient_id,payload,signature,delivered,timestamp,stored_at,expires_at,delivered_at)
                           VALUES (?,?,?,?,'',?,?,?,?,?)""",
                        (msg_id, user_id, recipient_id, data.get("payload", ""),
                         1 if delivered else 0, now2, now2, expires, now2 if delivered else None),
                    )
                    conn.commit()

                    await websocket.send_json({"type": "message_ack", "message_id": msg_id, "delivered": delivered})

            elif data["type"] == "typing":
                rid = data.get("recipient_id")
                if rid:
                    await manager.send_personal_message(rid, {"type": "typing", "sender_id": user_id})

            elif data["type"] == "ping":
                await websocket.send_json({"type": "pong"})
                conn.execute("UPDATE users SET last_seen=? WHERE user_id=?", (now_iso(), user_id))
                conn.commit()

            elif data["type"] == "get_peers":
                online = manager.get_online_users()
                await websocket.send_json({"type": "peers_list", "peers": online, "count": len(online)})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error {user_id[:20]}...: {e}")
    finally:
        manager.disconnect(user_id)
        conn.execute("UPDATE users SET online=0, last_seen=? WHERE user_id=?", (now_iso(), user_id))
        conn.commit()
        logger.info(f"WS disconnected: {user_id[:20]}...")

# ============ App Config ============

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    init_db()
    logger.info("XAMTON Relay started")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
