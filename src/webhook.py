import logging
import hashlib
from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from src.wallet_capture import WalletPayloadError

logger = logging.getLogger(__name__)


def create_webhook_app(user_manager, bot=None) -> FastAPI:
    """Create the Apple Wallet webhook FastAPI app.

    user_manager: object with .get(username) → UserContext | None
    bot: optional TelegramBotService for first-transaction notification
    """
    app = FastAPI()

    @app.post("/webhook/apple-wallet/{username}")
    async def receive_apple_wallet(username: str, request: Request):
        ctx = user_manager.get(username)
        if ctx is None:
            raise HTTPException(status_code=404, detail="User not found")

        storage = ctx.storage
        authorization = request.headers.get("Authorization")
        digest = None
        if authorization is not None:
            scheme, _, token = authorization.partition(" ")
            if scheme.lower() != "bearer" or not token:
                raise HTTPException(status_code=401, detail="Invalid Wallet credential")
            digest = hashlib.sha256(token.encode()).hexdigest()
        if not await run_in_threadpool(storage.authorize_wallet, digest):
            raise HTTPException(status_code=401, detail="Wallet credential required")
        # The user's one ingestion pipeline (shared with Gmail), so Wallet
        # captures get the same categorizer, FX rates and notifications.
        body = await request.body()
        try:
            tx_dict, tx_id = await run_in_threadpool(ctx.poller.pipeline.ingest_wallet_request, body)
        except WalletPayloadError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
        if tx_dict is None:
            return {"status": "duplicate", "transaction_id": tx_id}

        await run_in_threadpool(_maybe_notify_first_apple_wallet, storage, bot, username)
        return {"status": "ok", "transaction_id": tx_dict["id"]}

    return app


def _maybe_notify_first_apple_wallet(storage, bot, username: str) -> None:
    """Send a one-time Telegram notification when the first Apple Wallet tx arrives."""
    if bot is None:
        return
    try:
        if storage.count_transactions_from("apple_wallet", cap=2) == 1:
            bot.notify_text(
                "Apple Wallet is working — your first transaction just came through.",
                username,
            )
    except Exception as e:
        logger.warning("first-apple-wallet notification failed: %s", e)
