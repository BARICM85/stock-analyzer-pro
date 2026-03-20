from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Transaction
from ..schemas import TransactionIn, TransactionOut

router = APIRouter(prefix='/portfolio', tags=['portfolio'])


@router.get('/transactions', response_model=list[TransactionOut])
def list_transactions(user_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id)
        .order_by(Transaction.date.desc(), Transaction.created_at.desc())
        .all()
    )
    return [
        TransactionOut(
            id=r.id,
            user_id=r.user_id,
            date=r.date,
            script_name=r.script_name,
            exchange=r.exchange,
            quantity=r.quantity,
            price=r.price,
            side=r.side,
        )
        for r in rows
    ]


@router.post('/transactions', response_model=TransactionOut)
def upsert_transaction(payload: TransactionIn, db: Session = Depends(get_db)):
    row = db.query(Transaction).filter(Transaction.id == payload.id).first()
    if row is None:
        row = Transaction(id=payload.id)
        db.add(row)

    row.user_id = payload.user_id
    row.date = payload.date
    row.script_name = payload.script_name.upper()
    row.exchange = payload.exchange
    row.quantity = payload.quantity
    row.price = payload.price
    row.side = payload.side
    row.created_at = datetime.utcnow()

    db.commit()

    return TransactionOut(
        id=row.id,
        user_id=row.user_id,
        date=row.date,
        script_name=row.script_name,
        exchange=row.exchange,
        quantity=row.quantity,
        price=row.price,
        side=row.side,
    )


@router.delete('/transactions/{tx_id}')
def delete_transaction(tx_id: str, user_id: str, db: Session = Depends(get_db)):
    row = (
        db.query(Transaction)
        .filter(Transaction.id == tx_id, Transaction.user_id == user_id)
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {'deleted': True}
