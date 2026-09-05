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
        # Resolve per-user pipeline from the poller if available
        pipeline = getattr(ctx.poller, "pipeline", None) if ctx.poller else None
        # Resolve categorizer and exchange service from context attributes
        categorizer = getattr(ctx, "categorizer", None)
        exchange_service = getattr(ctx, "exchange_service", None)

        if pipeline is None:
            from src.ingestion import IngestionPipeline
            pipeline = IngestionPipeline(storage, categorizer, exchange_service)
        body = await request.body()
        try:
            tx_dict, tx_id = await run_in_threadpool(pipeline.ingest_wallet_request, body)
        except WalletPayloadError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
        if tx_dict is None:
            return {"status": "duplicate", "transaction_id": tx_id}

        on_transaction = getattr(ctx, "on_transaction", None)
        if on_transaction:
            on_transaction(tx_dict["id"], tx_dict["amount"], tx_dict["merchant"],
                           tx_dict["category"], tx_dict["_match_source"], tx_dict["source"])
        _maybe_notify_first_apple_wallet(storage, bot, username)
        return {"status": "ok", "transaction_id": tx_dict["id"]}

    return app


def _maybe_notify_first_apple_wallet(storage, bot, username: str) -> None:
    """Send a one-time Telegram notification when the first Apple Wallet tx arrives."""
    if bot is None:
        return
    try:
        count = storage._conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE source = 'apple_wallet'"
        ).fetchone()[0]
        if count == 1:
            bot.notify_text(
                "Apple Wallet is working — your first transaction just came through.",
                username,
            )
    except Exception as e:
        logger.warning("first-apple-wallet notification failed: %s", e)
